// url.js: Tiện ích URL công khai, ký Return URL cho merchant và kiểm tra an toàn chống SSRF cho Callback/Return URL.
const dns = require("dns");
const net = require("net");
const { httpError } = require("../common/http");
const { computeSignature } = require("./keys");

// --- Cấu hình URL công khai & ký Return URL ---

/**
 * Đọc và chuẩn hóa origin từ biến môi trường `PUBLIC_BASE_URL`.
 *
 * @returns {string|null} Origin chuẩn (vd: "https://api.example.com") hoặc `null` nếu chưa cấu hình
 * @throws {Error} Khi URL sai định dạng hoặc không dùng giao thức `http`/`https`
 */
function readConfiguredBaseUrl() {
  const raw = (process.env.PUBLIC_BASE_URL || "").trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error("Địa chỉ máy chủ không phải URL hợp lệ");
  }

  // Chỉ chấp nhận http/https để chặn scheme nguy hiểm (ftp:, javascript:, ...)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Địa chỉ máy chủ phải bắt đầu bằng http hoặc https");
  }

  // Lấy origin chuẩn (giao thức + host + port), bỏ path/query và dấu "/" thừa
  return parsed.origin;
}

/**
 * Kiểm tra cấu hình `PUBLIC_BASE_URL` ngay lúc khởi động server
 * để dừng sớm nếu thiếu hoặc sai định dạng (thay vì đợi tới request đầu tiên).
 */
function assertPublicBaseUrlConfigured() {
  const configured = readConfiguredBaseUrl();
  if (!configured) {
    throw new Error("Thiếu địa chỉ máy chủ");
  }
}

/**
 * Lấy địa chỉ gốc công khai để tạo link (ưu tiên `PUBLIC_BASE_URL`, dự phòng lấy từ request).
 */
function getPublicBaseUrl(req) {
  const configured = readConfiguredBaseUrl();
  if (configured) return configured;

  return `${req.protocol}://${req.get("host")}`;
}

function buildSignedReturnUrl({
  returnUrl,
  secretKey,
  paymentId,
  orderId,
  amount,
  status,
  paidAt,
  time = Math.floor(Date.now() / 1000),
}) {
  let u;
  try {
    u = new URL(returnUrl);
  } catch (_) {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;

  const paidAtIso = paidAt ? new Date(paidAt).toISOString() : "";
  const timestamp = String(time);
  const data = [paymentId, String(amount), status, paidAtIso, orderId].join(
    "|",
  );
  const signature = computeSignature(secretKey, timestamp, data);
  u.searchParams.set("order_id", orderId);
  u.searchParams.set("payment_id", paymentId);
  u.searchParams.set("amount", String(amount));
  u.searchParams.set("status", status);
  if (paidAtIso) u.searchParams.set("paid_at", paidAtIso);
  else u.searchParams.delete("paid_at");
  u.searchParams.set("timestamp", timestamp);
  u.searchParams.set("signature", signature);
  return u.toString();
}

// --- Cấu hình môi trường kiểm tra SSRF ---

// Chỉ bật "true" ở môi trường dev để test callback/return về localhost hoặc IP nội bộ
const allowPrivate = () => process.env.ALLOW_PRIVATE_CALLBACKS === "true";
const allowPrivateReturn = () => process.env.ALLOW_PRIVATE_RETURN_URL === "true";
const isProduction = () => process.env.NODE_ENV === "production";

// --- Kiểm tra IP nội bộ (IPv4 & IPv6) ---

/**
 * Chuyển IPv4 dạng chuỗi sang số nguyên 32-bit để so sánh nhanh theo dải CIDR.
 * Ví dụ: "10.0.0.1" -> 10*256³ + 0*256² + 0*256 + 1
 */
function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, p) => acc * 256 + Number(p), 0);
}

// Danh sách dải IPv4 không phải địa chỉ công khai (chuyển sẵn sang { base, mask } để so bit)
const V4_BLOCKS = [
  ["0.0.0.0", 8],      // Mạng hiện tại ("this network")
  ["10.0.0.0", 8],     // Mạng riêng (Private Class A)
  ["100.64.0.0", 10],  // CGNAT (mạng nhà mạng)
  ["127.0.0.0", 8],    // Loopback (localhost)
  ["169.254.0.0", 16], // Link-local & Cloud Metadata (169.254.169.254)
  ["172.16.0.0", 12],  // Mạng riêng (Private Class B)
  ["192.0.0.0", 24],   // Dải dành riêng IETF
  ["192.168.0.0", 16], // Mạng riêng (LAN / Wifi nội bộ)
  ["198.18.0.0", 15],  // Dải benchmark mạng
  ["224.0.0.0", 4],    // Multicast
  ["240.0.0.0", 4],    // Dự phòng
].map(([base, bits]) => ({
  base: ipv4ToInt(base),
  // Tạo bitmask gồm `bits` bit 1 ở đầu; ">>> 0" ép về số nguyên không dấu 32-bit
  mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0,
}));

/**
 * Kiểm tra IPv4 có nằm trong các dải nội bộ/đặc biệt bị chặn hay không.
 */
function isPrivateIPv4(ip) {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(({ base, mask }) => ((n & mask) >>> 0) === (base & mask) >>> 0);
}

/**
 * Chuẩn hóa IPv6 (kể cả dạng rút gọn "::" và đuôi IPv4-mapped) thành mảng 8 số 16-bit.
 */
function expandIPv6(ip) {
  // Bỏ phần zone interface (vd "%eth0") và chuẩn hóa chữ thường
  let v = ip.toLowerCase().split("%")[0];

  // Đổi đuôi IPv4-mapped (vd "::ffff:1.2.3.4") thành 2 nhóm hex 16-bit
  const tail = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = ipv4ToInt(tail[1]);
    v =
      v.slice(0, -tail[1].length) +
      ((n >>> 16) & 0xffff).toString(16) +
      ":" +
      (n & 0xffff).toString(16);
  }

  // Mở rộng phần rút gọn "::" bằng các nhóm "0" cho đủ 8 nhóm
  const [head, rest] = v.split("::");
  const h = head ? head.split(":") : [];
  const r = rest !== undefined && rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array(8 - h.length - r.length).fill("0");
  return [...h, ...fill, ...r].map((g) => parseInt(g || "0", 16));
}

/**
 * Kiểm tra IPv6 có thuộc dải nội bộ/loopback/IPv4-mapped nội bộ hay không.
 */
function isPrivateIPv6(ip) {
  const g = expandIPv6(ip);
  // Định dạng bất thường -> từ chối cho an toàn
  if (g.length !== 8 || g.some(Number.isNaN)) return true;

  if (g.every((x) => x === 0)) return true; // :: (unspecified)
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 (loopback)

  // Chặn mẹo bọc IPv4 nội bộ trong IPv6 (vd "::ffff:127.0.0.1" -> ::ffff:7f00:1)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPrivateIPv4(v4);
  }

  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (unique local)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  return false;
}

/**
 * Kiểm tra 1 địa chỉ IP (v4 hoặc v6) có phải địa chỉ nội bộ hay không.
 * Nếu không phải IP hợp lệ -> coi như không an toàn (trả `true`).
 */
function isPrivateAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true;
}

// --- Kiểm tra cú pháp & phân giải DNS của URL ---

/**
 * Kiểm tra cú pháp URL (không gọi DNS):
 * bắt buộc `http`/`https` (production bắt buộc `https`), cấm `user:pass@host`,
 * và chặn hostname trỏ thẳng về localhost hoặc IP nội bộ.
 *
 * @returns {URL} Đối tượng URL đã parse hợp lệ
 */
function validateCallbackUrlSyntax(
  raw,
  label = "Callback URL",
  allowPrivateOverride,
) {
  const priv = allowPrivateOverride ?? allowPrivate();
  let parsed;
  try {
    parsed = new URL(String(raw).trim());
  } catch (_) {
    throw new Error(`${label} không hợp lệ`);
  }

  // Chặn các giao thức nguy hiểm như file:, ftp:, gopher:, ...
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} phải bắt đầu bằng http hoặc https`);
  }
  if (isProduction() && parsed.protocol !== "https:" && !priv) {
    throw new Error(`${label} phải dùng https`);
  }
  // Chặn dạng https://user:pass@host dùng để giả mạo/đánh lừa parser
  if (parsed.username || parsed.password) {
    throw new Error(`${label} không được chứa thông tin đăng nhập`);
  }

  if (!priv) {
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
      throw new Error(`${label} không được trỏ về địa chỉ nội bộ`);
    }
    if (net.isIP(host) && isPrivateAddress(host)) {
      throw new Error(`${label} không được trỏ về địa chỉ nội bộ`);
    }
  }
  return parsed;
}

/**
 * Kiểm tra đầy đủ URL trước khi gửi request hoặc lưu DB:
 * gồm kiểm tra cú pháp và tra DNS thực tế để chặn tên miền trỏ về IP nội bộ.
 */
async function assertSafeCallbackUrl(
  raw,
  label = "Callback URL",
  allowPrivateOverride,
) {
  const priv = allowPrivateOverride ?? allowPrivate();
  const parsed = validateCallbackUrlSyntax(raw, label, priv);
  if (priv) return parsed;

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return parsed;

  // Tra toàn bộ IP của tên miền; chỉ cần lẫn 1 IP nội bộ là từ chối
  const addrs = await dns.promises.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${label} phân giải về địa chỉ nội bộ`);
  }
  return parsed;
}

// --- Hàm kiểm tra URL dùng lúc lưu vào DB ---

/**
 * Hàm dùng chung để validate độ dài, cú pháp và DNS của URL trước khi lưu DB.
 * Ánh xạ lỗi thành `httpError(400)` (URL/tên miền sai) hoặc `httpError(503)` (lỗi DNS tạm thời).
 */
async function validateUrlForSave(
  raw,
  { label, maxLength, allowPrivate: priv },
) {
  const value = String(raw ?? "").trim();
  if (value.length > maxLength) {
    throw httpError(400, `${label} quá dài`);
  }
  try {
    await assertSafeCallbackUrl(value, label, priv);
  } catch (e) {
    if (e.code === "ENOTFOUND" || e.code === "ENODATA") {
      throw httpError(
        400,
        `Không tìm thấy tên miền của ${label}, vui lòng kiểm tra lại`,
      );
    }
    if (e.syscall === "getaddrinfo") {
      throw httpError(
        503,
        `Không kiểm tra được tên miền của ${label}, vui lòng thử lại sau`,
      );
    }
    throw httpError(400, e.message);
  }
  return value;
}

/**
 * Validate Callback URL lúc đăng ký hoặc cập nhật cấu hình merchant (mặc định tối đa 2048 ký tự).
 */
async function validateCallbackUrlForSave(raw, options = {}) {
  return validateUrlForSave(raw, {
    label: "Callback URL",
    maxLength: options.maxLength ?? 2048,
    allowPrivate: options.allowPrivate ?? allowPrivate(),
  });
}

/**
 * Validate Return URL lúc tạo đơn thanh toán (tối đa 255 ký tự, theo cờ `ALLOW_PRIVATE_RETURN_URL`).
 */
async function validateReturnUrlForSave(raw) {
  return validateUrlForSave(raw, {
    label: "Return URL",
    maxLength: 255,
    allowPrivate: allowPrivateReturn(),
  });
}

// --- DNS lookup tùy biến cho HTTP/HTTPS Agent ---

/**
 * Hàm `lookup` tùy biến cho `http.Agent` / `https.Agent`:
 * kiểm tra lại IP ngay tại thời điểm mở socket để chống tấn công DNS rebinding.
 */
function safeLookup(hostname, options, callback) {
  // Hỗ trợ cả 2 chữ ký gọi chuẩn của Node: lookup(host, cb) và lookup(host, opts, cb)
  const opts = typeof options === "function" ? {} : options || {};
  const cb = typeof options === "function" ? options : callback;

  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);

    if (!allowPrivate() && addrs.some((a) => isPrivateAddress(a.address))) {
      return cb(new Error("Địa chỉ đích nằm trong dải nội bộ"));
    }

    if (opts.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

module.exports = {
  getPublicBaseUrl,
  assertPublicBaseUrlConfigured,
  buildSignedReturnUrl,
  validateCallbackUrlSyntax,
  assertSafeCallbackUrl,
  validateCallbackUrlForSave,
  validateReturnUrlForSave,
  safeLookup,
  isPrivateAddress,
};

