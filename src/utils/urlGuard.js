const dns = require("dns");
const net = require("net");
const { httpError } = require("./httpError");

// Cho phép callback về localhost/IP nội bộ khi dev: ALLOW_PRIVATE_CALLBACKS=true
const allowPrivate = () => process.env.ALLOW_PRIVATE_CALLBACKS === "true";
// Cho phép return_url về localhost/IP nội bộ khi dev: ALLOW_PRIVATE_RETURN_URL=true
// (khác "true" hoặc không đặt = chế độ chặt, kiểm tra giống Callback URL)
const allowPrivateReturn = () => process.env.ALLOW_PRIVATE_RETURN_URL === "true";
const isProduction = () => process.env.NODE_ENV === "production";

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, p) => acc * 256 + Number(p), 0);
}

const V4_BLOCKS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([base, bits]) => ({
  base: ipv4ToInt(base),
  mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0,
}));

function isPrivateIPv4(ip) {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(({ base, mask }) => ((n & mask) >>> 0) === (base & mask) >>> 0);
}

function expandIPv6(ip) {
  // Trả về 8 nhóm 16-bit; hỗ trợ "::" và đuôi dạng IPv4 (a.b.c.d).
  let v = ip.toLowerCase().split("%")[0];
  const tail = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = ipv4ToInt(tail[1]);
    v = v.slice(0, -tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const [head, rest] = v.split("::");
  const h = head ? head.split(":") : [];
  const r = rest !== undefined && rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array(8 - h.length - r.length).fill("0");
  return [...h, ...fill, ...r].map((g) => parseInt(g || "0", 16));
}

function isPrivateIPv6(ip) {
  const g = expandIPv6(ip);
  if (g.length !== 8 || g.some(Number.isNaN)) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d (URL parser đổi sang dạng hex ::ffff:7f00:1)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPrivateIPv4(v4);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

function isPrivateAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true;
}

/**
 * Kiểm tra cú pháp URL, không cần DNS. Trả về URL đã parse hoặc ném Error có message tiếng Việt.
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
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} phải bắt đầu bằng http hoặc https`);
  }
  if (isProduction() && parsed.protocol !== "https:" && !priv) {
    throw new Error(`${label} phải dùng https`);
  }
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
 * Kiểm tra đầy đủ lúc gửi: cú pháp + DNS phải ra IP công khai.
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
  if (net.isIP(host)) return parsed; // đã kiểm tra ở trên
  const addrs = await dns.promises.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${label} phân giải về địa chỉ nội bộ`);
  }
  return parsed;
}

/**
 * Kiểm tra Callback URL ngay lúc lưu (đăng ký merchant, đổi callback).
 * Hành vi theo ALLOW_PRIVATE_CALLBACKS (khác "true" hoặc không đặt = chế độ chặt):
 *  - chặn localhost / IP nội bộ, production bắt buộc https, không chứa user:pass;
 *  - tên miền phải phân giải về IP công khai.
 * Đặt ALLOW_PRIVATE_CALLBACKS=true (máy dev) thì chỉ kiểm tra cú pháp.
 * Trả về URL đã trim để lưu; lỗi ném httpError 400 (hoặc 503 khi DNS tạm thời lỗi).
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
 */
function safeLookup(hostname, options, callback) {
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
  validateCallbackUrlSyntax,
  assertSafeCallbackUrl,
  validateCallbackUrlForSave,
  validateReturnUrlForSave,
  safeLookup,
  isPrivateAddress,
};