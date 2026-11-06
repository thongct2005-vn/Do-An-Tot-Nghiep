const dns = require("dns");
const net = require("net");
const { httpError } = require("./httpError");

// Cho phép callback về localhost/IP nội bộ khi dev: ALLOW_PRIVATE_CALLBACKS=true
const allowPrivate = () => process.env.ALLOW_PRIVATE_CALLBACKS === "true";
// Cho phép return_url về localhost/IP nội bộ khi dev: ALLOW_PRIVATE_RETURN_URL=true
// (khác "true" hoặc không đặt = chế độ chặt, kiểm tra giống Callback URL)
const allowPrivateReturn = () => process.env.ALLOW_PRIVATE_RETURN_URL === "true";
const isProduction = () => process.env.NODE_ENV === "production";

// Đổi IPv4 dạng chuỗi → số nguyên để so sánh theo dải.
// vd "10.0.0.1" → 10*256³ + 0*256² + 0*256 + 1
function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, p) => acc * 256 + Number(p), 0);
}

// Các dải IPv4 không phải địa chỉ công khai: [địa chỉ gốc, số bit đầu cố định] (CIDR)
// Mỗi dải được đổi sang { base, mask } để kiểm tra bằng phép AND bit.
const V4_BLOCKS = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // mạng riêng
  ["100.64.0.0", 10], // CGNAT (mạng nhà cung cấp)
  ["127.0.0.0", 8], // loopback (localhost)
  ["169.254.0.0", 16], // link-local, gồm cả metadata cloud 169.254.169.254
  ["172.16.0.0", 12], // mạng riêng
  ["192.0.0.0", 24], // dải dành riêng của IETF
  ["192.168.0.0", 16], // mạng riêng (mạng LAN/wifi nhà)
  ["198.18.0.0", 15], // dải dùng để benchmark mạng
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // dự phòng
].map(([base, bits]) => ({
  base: ipv4ToInt(base),
  // mask = `bits` bit 1 đứng đầu, vd /8 → 255.0.0.0. ">>> 0" để ra số không dấu
  mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0,
}));

// IPv4 có nằm trong dải nội bộ nào không:
// (ip AND mask) bằng (base AND mask) nghĩa là ip thuộc dải đó
function isPrivateIPv4(ip) {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(({ base, mask }) => ((n & mask) >>> 0) === (base & mask) >>> 0);
}

// Đổi IPv6 (nhiều cách viết rút gọn) → mảng 8 số, mỗi số là 1 nhóm 16 bit.
function expandIPv6(ip) {
  // Trả về 8 nhóm 16-bit; hỗ trợ "::" và đuôi dạng IPv4 (a.b.c.d).
  // Bỏ phần zone "%eth0" (nếu có) và đổi về chữ thường
  let v = ip.toLowerCase().split("%")[0];
  // Nếu đuôi là IPv4 (vd ::ffff:1.2.3.4) thì đổi thành 2 nhóm hex
  const tail = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = ipv4ToInt(tail[1]);
    v = v.slice(0, -tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  // "::" đại diện cho 1 dãy nhóm toàn số 0: tách thành phần đầu (head) và phần sau (rest)
  const [head, rest] = v.split("::");
  const h = head ? head.split(":") : [];
  const r = rest !== undefined && rest ? rest.split(":") : [];
  // Điền thêm các nhóm "0" vào chỗ "::" cho đủ 8 nhóm
  const fill = rest === undefined ? [] : Array(8 - h.length - r.length).fill("0");
  return [...h, ...fill, ...r].map((g) => parseInt(g || "0", 16));
}

// IPv6 có phải địa chỉ nội bộ không
function isPrivateIPv6(ip) {
  const g = expandIPv6(ip);
  // Không đủ 8 nhóm hoặc có nhóm không phải số → coi là nội bộ (từ chối cho an toàn)
  if (g.length !== 8 || g.some(Number.isNaN)) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d (URL parser đổi sang dạng hex ::ffff:7f00:1)
  // Lấy lại IPv4 bên trong rồi kiểm tra như IPv4 (chặn mẹo "::ffff:127.0.0.1")
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPrivateIPv4(v4);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

// Kiểm tra 1 địa chỉ IP (v4 hoặc v6) có nội bộ không.
// Không phải IP hợp lệ → trả true (coi như nội bộ, chặn cho an toàn).
function isPrivateAddress(ip) {
  const kind = net.isIP(ip); // 4, 6 hoặc 0 (không phải IP)
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true;
}

/**
 * Kiểm tra cú pháp URL, không cần DNS. Trả về URL đã parse hoặc ném Error có message tiếng Việt.
 * Các điều kiện: đúng URL, http/https, production phải https, không có user:pass,
 * không trỏ thẳng về localhost/IP nội bộ.
 */
function validateCallbackUrlSyntax(
  raw,
  label = "Callback URL",
  allowPrivateOverride,
) {
  // Ưu tiên giá trị truyền vào, không có thì đọc từ biến môi trường
  const priv = allowPrivateOverride ?? allowPrivate();
  let parsed;
  try {
    parsed = new URL(String(raw).trim());
  } catch (_) {
    throw new Error(`${label} không hợp lệ`);
  }
  // Chỉ http/https (chặn file:, ftp:, gopher:...)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} phải bắt đầu bằng http hoặc https`);
  }
  // Production bắt buộc https (trừ khi bật cho phép nội bộ)
  if (isProduction() && parsed.protocol !== "https:" && !priv) {
    throw new Error(`${label} phải dùng https`);
  }
  // Chặn dạng https://user:pass@host (hay dùng để lừa đảo hoặc giấu host thật)
  if (parsed.username || parsed.password) {
    throw new Error(`${label} không được chứa thông tin đăng nhập`);
  }
  if (!priv) {
    // Bỏ [ ] quanh IPv6 và đổi về chữ thường
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    // Chặn tên miền nội bộ rõ ràng
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
      throw new Error(`${label} không được trỏ về địa chỉ nội bộ`);
    }
    // Nếu host là IP thì kiểm tra luôn có thuộc dải nội bộ không
    if (net.isIP(host) && isPrivateAddress(host)) {
      throw new Error(`${label} không được trỏ về địa chỉ nội bộ`);
    }
  }
  return parsed;
}

/**
 * Kiểm tra đầy đủ lúc gửi: cú pháp + DNS phải ra IP công khai.
 * Cần thêm bước DNS vì tên miền công khai (vd evil.com) có thể trỏ về 127.0.0.1.
 */
async function assertSafeCallbackUrl(
  raw,
  label = "Callback URL",
  allowPrivateOverride,
) {
  const priv = allowPrivateOverride ?? allowPrivate();
  const parsed = validateCallbackUrlSyntax(raw, label, priv);
  if (priv) return parsed; // chế độ dev: chỉ cần đúng cú pháp
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return parsed; // đã kiểm tra ở trên
  // Tra DNS lấy tất cả IP của tên miền; chỉ cần 1 IP nội bộ là từ chối
  const addrs = await dns.promises.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${label} phân giải về địa chỉ nội bộ`);
  }
  return parsed;
}

/**
 * Hàm dùng chung cho Callback URL và Return URL lúc LƯU vào DB.
 * Kiểm tra độ dài + assertSafeCallbackUrl, rồi đổi lỗi thành httpError với mã phù hợp:
 *  - 400 nếu URL sai hoặc tên miền không tồn tại (ENOTFOUND/ENODATA)
 *  - 503 nếu DNS tạm thời lỗi (lỗi hệ thống, không phải lỗi của người dùng)
 * Trả về URL đã trim để lưu.
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
 * Kiểm tra Callback URL ngay lúc lưu (đăng ký merchant, đổi callback).
 * Hành vi theo ALLOW_PRIVATE_CALLBACKS (khác "true" hoặc không đặt = chế độ chặt):
 *  - chặn localhost / IP nội bộ, production bắt buộc https, không chứa user:pass;
 *  - tên miền phải phân giải về IP công khai.
 * Đặt ALLOW_PRIVATE_CALLBACKS=true (máy dev) thì chỉ kiểm tra cú pháp.
 * Trả về URL đã trim để lưu; lỗi ném httpError 400 (hoặc 503 khi DNS tạm thời lỗi).
 */
async function validateCallbackUrlForSave(raw) {
  return validateUrlForSave(raw, {
    label: "Callback URL",
    maxLength: 2048,
    allowPrivate: allowPrivate(),
  });
}

/**
 * Kiểm tra Return URL lúc tạo thanh toán. Hành vi theo ALLOW_PRIVATE_RETURN_URL
 * (khác "true" hoặc không đặt = chế độ chặt, giống Callback URL):
 *  - chặn localhost / IP nội bộ, production bắt buộc https, không chứa user:pass;
 *  - tên miền phải phân giải về IP công khai.
 * Đặt ALLOW_PRIVATE_RETURN_URL=true (máy dev) thì chỉ kiểm tra cú pháp.
 * Trả về URL đã trim; lỗi ném httpError 400 (hoặc 503 khi DNS tạm thời lỗi).
 */
async function validateReturnUrlForSave(raw) {
  return validateUrlForSave(raw, {
    label: "Return URL",
    maxLength: 255,
    allowPrivate: allowPrivateReturn(),
  });
}

/**
 * `lookup` tuỳ biến cho http(s).Agent: kiểm tra IP ngay lúc kết nối,
 * chặn DNS rebinding (đổi IP giữa lúc kiểm tra và lúc gửi).
 * DNS rebinding: lúc lưu URL, tên miền trỏ IP công khai (qua kiểm tra); lúc gửi thật,
 * kẻ xấu đổi DNS sang 127.0.0.1. Kiểm tra lại đúng lúc kết nối sẽ chặn được.
 */
function safeLookup(hostname, options, callback) {
  // dns.lookup có thể được gọi với (hostname, callback) hoặc (hostname, options, callback)
  const opts = typeof options === "function" ? {} : options || {};
  const cb = typeof options === "function" ? options : callback;
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    // Có IP nội bộ trong kết quả thì từ chối kết nối
    if (!allowPrivate() && addrs.some((a) => isPrivateAddress(a.address))) {
      return cb(new Error("Địa chỉ đích nằm trong dải nội bộ"));
    }
    // Trả kết quả đúng định dạng mà người gọi yêu cầu (danh sách hoặc 1 địa chỉ)
    if (opts.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

module.exports = {
  validateCallbackUrlSyntax,
  assertSafeCallbackUrl,
  validateCallbackUrlForSave,
  validateReturnUrlForSave,
  safeLookup,
  isPrivateAddress,
};