const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

/* ============================================================
 * Hằng số thời gian
 * ============================================================ */
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const WEEK = 7 * 24 * HOUR;

/* ============================================================
 * Hàm tạo limiter dùng chung
 * - Không truyền keyGenerator: đếm theo IP (mặc định)
 * - Có keyGenerator: đếm theo khóa tùy chỉnh (user, phone, IP + phone...)
 * - skipSuccessfulRequests: true -> chỉ tính các lần thất bại (status >= 400)
 * ============================================================ */
const createLimiter = ({
  windowMs,
  limit,
  keyGenerator,
  skipSuccessfulRequests = false,
}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    requestWasSuccessful: (req, res) =>
      res.statusCode < 400 || Boolean(req.risk?.blocked),
    ...(keyGenerator && { keyGenerator }),
    handler: (req, res, next) => {
      const err = new Error("Bạn thao tác quá nhiều lần, vui lòng thử lại sau");
      err.statusCode = 429;
      next(err);
    },
  });

/* ============================================================
 * Hàm lấy khóa đếm (keyGenerator)
 * ============================================================ */
// Chuẩn hóa SĐT (+84912... / 84912... -> 0912...) để tránh lách bằng cách đổi đầu số
const normalizePhone = (phone) => {
  if (!phone || phone === "INVALID" || typeof phone === "object") return "";
  const digits = String(phone)
    .trim()
    .replace(/^\+84/, "0")
    .replace(/\D/g, "")
    .slice(0, 15);
  if (digits.length === 11 && digits.startsWith("84")) {
    return `0${digits.slice(2)}`;
  }
  return digits;
};

// Trích xuất định danh tài khoản mục tiêu khi chưa đăng nhập (ưu tiên phone -> email)
const extractTarget = (req) => {
  const phone = normalizePhone(req.body?.phone);
  if (phone) return `phone:${phone}`;
  const rawEmail = req.body?.email;
  if (!rawEmail || rawEmail === "INVALID" || typeof rawEmail !== "string") {
    return null;
  }
  const email = rawEmail.trim().toLowerCase().slice(0, 100);
  if (email) return `email:${email}`;
  return null;
};

// 1. Đếm theo IP (dùng cho API tra cứu/quét hàng loạt chưa đăng nhập)
const byIp = (req) => `ip:${ipKeyGenerator(req.ip || "127.0.0.1")}`;

// 2. Đếm theo SĐT/Email mục tiêu (dùng cho gửi OTP/quên MK/đăng ký để chống spam vào 1 nạn nhân)
const byTarget = (req) => extractTarget(req) ?? byIp(req);

// 3. Đếm kết hợp IP + SĐT/Email (dùng cho đăng nhập: chống dò mật khẩu, không khóa oan chủ acc ở IP khác hay người chung Wi-Fi)
const byIpAndTarget = (req) => {
  if (req.user?.user_id) return `user:${req.user.user_id}`;
  const target = extractTarget(req);
  return target ? `${byIp(req)}:${target}` : byIp(req);
};

// 4. Đếm theo User đã xác thực (Access Token hoặc Token tạm: OTP / Forgot / Reset)
// Fallback về IP + Target nếu chưa qua middleware xác thực (tránh gom chung vào "anonymous")
const byUser = (req) => {
  const id =
    req.user?.user_id ??
    req.otpUser?.user_id ??
    req.otpUser?.phone ??
    req.forgotUser?.user_id ??
    req.resetUser?.user_id;
  return id ? `user:${id}` : byIpAndTarget(req);
};

// 5. Ưu tiên User/Token tạm nếu đã có, nếu chưa có token thì đếm theo SĐT/Email nhận OTP
const byActorOrTarget = (req) => {
  const id =
    req.user?.user_id ??
    req.otpUser?.user_id ??
    req.otpUser?.phone ??
    req.forgotUser?.user_id;
  return id ? `user:${id}` : byTarget(req);
};

/* ============================================================
 * MODULE 1: Xác thực (đăng nhập, đăng ký, tra cứu, OTP)
 * ============================================================ */
const authLimiters = {
  // Tra cứu SĐT/Email tồn tại: đếm theo IP để chống quét danh sách khách hàng
  lookupLimiter: createLimiter({
    windowMs: 5 * MINUTE,
    limit: 30,
    keyGenerator: byIp,
  }),

  // Đăng ký: 2 lớp (chặn spam OTP vào 1 SĐT/Email + chặn 1 IP tạo hàng loạt tài khoản rác)
  registerLimiter: [
    createLimiter({
      windowMs: 15 * MINUTE,
      limit: 10,
      keyGenerator: byTarget,
    }),
    createLimiter({
      windowMs: 15 * MINUTE,
      limit: 10,
      keyGenerator: byIp,
    }),
  ],

  // Đăng nhập & TOTP setup/recover: 2 lớp
  // - Lớp 1 (IP + SĐT/Email): chỉ đếm lần sai, sai 8 lần/15p mới chặn cặp IP+SĐT đó
  // - Lớp 2 (IP tổng): chặn 1 IP thử mật khẩu rải rác trên nhiều SĐT
  loginLimiter: [
    createLimiter({
      windowMs: 15 * MINUTE,
      limit: 8,
      keyGenerator: byIpAndTarget,
      skipSuccessfulRequests: true,
    }),
    createLimiter({
      windowMs: 15 * MINUTE,
      limit: 30,
      keyGenerator: byIp,
    }),
  ],

  // Đăng xuất: đếm theo user đã đăng nhập
  logoutLimiter: createLimiter({
    windowMs: 15 * MINUTE,
    limit: 20,
    keyGenerator: byUser,
  }),

  // Xác thực mã OTP / TOTP 6 số: đếm theo phiên user (chỉ tính lần nhập sai, tối đa 5 lần/5p)
  otpLimiter: createLimiter({
    windowMs: 5 * MINUTE,
    limit: 5,
    keyGenerator: byUser,
    skipSuccessfulRequests: true,
  }),

  // Gửi / gửi lại mã OTP: 2 lớp (chống bom OTP vào 1 người + chống 1 IP đốt quota Email/SMS)
  sendOtpLimiter: [
    createLimiter({
      windowMs: 5 * MINUTE,
      limit: 5,
      keyGenerator: byActorOrTarget,
    }),
    createLimiter({
      windowMs: 5 * MINUTE,
      limit: 15,
      keyGenerator: byIp,
    }),
  ],
};

/* ============================================================
 * MODULE 2: Quên mật khẩu / PIN
 * ============================================================ */
const forgotLimiters = {
  // Yêu cầu quên MK/PIN (chưa có token): 2 lớp theo SĐT nhận OTP + theo IP tổng
  forgotRequestLimiter: [
    createLimiter({
      windowMs: 15 * MINUTE,
      limit: 5,
      keyGenerator: byTarget,
    }),
    createLimiter({
      windowMs: 15 * MINUTE,
      limit: 10,
      keyGenerator: byIp,
    }),
  ],
  forgotKycLimiter: createLimiter({
    windowMs: WEEK,
    limit: 1,
    keyGenerator: byUser,
  }),
  resetCredentialLimiter: createLimiter({
    windowMs: 15 * MINUTE,
    limit: 5,
    keyGenerator: byUser,
  }),
};

/* ============================================================
 * MODULE 3: Bảo mật tài khoản (đổi PIN, đổi mật khẩu)
 * ============================================================ */
const accountLimiters = {
  updatePin: createLimiter({
    windowMs: WEEK,
    limit: 1,
    keyGenerator: byUser,
  }),
  updatePassWord: createLimiter({
    windowMs: WEEK,
    limit: 1,
    keyGenerator: byUser,
  }),
};

/* ============================================================
 * MODULE 4: Giao dịch (chuyển/nạp/rút/thanh toán, kiểm tra PIN)
 * ============================================================ */
const transactionLimiters = {
  transactionLimiter: createLimiter({
    windowMs: MINUTE,
    limit: 10,
    keyGenerator: byUser,
  }),
  pinCheckLimiter: createLimiter({
    windowMs: MINUTE,
    limit: 10,
    keyGenerator: byUser,
    skipSuccessfulRequests: true,
  }),
};

/* ============================================================
 * MODULE 5: Danh bạ / tìm người dùng
 * ============================================================ */

// Hạn mức tra cứu danh bạ mỗi ngày (số số điện thoại khác nhau / user / ngày)
const CONTACT_DAILY_LIMIT = 2000;
// userId → { day, hashes: Set } (lưu trong RAM, mất khi restart server)
const contactUsage = new Map();
// Ngày tính theo giờ Việt Nam (UTC+7)
const VN_OFFSET_MS = 7 * HOUR;

const currentDay = () =>
  new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);

// Mỗi giờ dọn dữ liệu của ngày cũ để Map không phình ra.
// unref() để timer này không giữ tiến trình sống khi server tắt.
setInterval(() => {
  const today = currentDay();
  for (const [userId, entry] of contactUsage) {
    if (entry.day !== today) contactUsage.delete(userId);
  }
}, HOUR).unref();

// Middleware: giới hạn số SĐT khác nhau một user được tra mỗi ngày.
// Số đã tra trong ngày không bị tính lại.
const contactDailyQuota = (req, res, next) => {
  const userId = req.user?.user_id;
  const phones = req.body?.phones;
  if (!userId || !Array.isArray(phones)) return next();

  const today = currentDay();
  let entry = contactUsage.get(userId);
  if (!entry || entry.day !== today) {
    entry = { day: today, hashes: new Set() };
    contactUsage.set(userId, entry);
  }

  // Chỉ những số chưa tra hôm nay mới tính vào hạn mức
  const fresh = new Set();
  for (const p of phones) {
    const key = String(p).slice(0, 16);
    if (!entry.hashes.has(key)) fresh.add(key);
  }

  if (entry.hashes.size + fresh.size > CONTACT_DAILY_LIMIT) {
    const err = new Error(
      "Bạn đã tra cứu danh bạ quá nhiều hôm nay, vui lòng thử lại vào ngày mai",
    );
    err.statusCode = 429;
    return next(err);
  }

  fresh.forEach((key) => entry.hashes.add(key));
  next();
};

const contactLimiters = {
  contactCheckLimiter: createLimiter({
    windowMs: MINUTE,
    limit: 100,
    keyGenerator: byUser,
  }),
  findUserLimiter: createLimiter({
    windowMs: MINUTE,
    limit: 10,
    keyGenerator: byUser,
  }),
  contactDailyQuota,
};

/* ============================================================
 * MODULE 7: Xuất dữ liệu (Excel...)
 * ============================================================ */
const exportLimiters = {
  exportLimiter: createLimiter({
    windowMs: 10 * MINUTE,
    limit: 5,
    keyGenerator: byUser,
  }),
};

/* ============================================================
 * Export phẳng: tên cũ giữ nguyên nên code nơi khác không phải sửa
 * ============================================================ */
module.exports = {
  ...authLimiters,
  ...forgotLimiters,
  ...accountLimiters,
  ...transactionLimiters,
  ...contactLimiters,
  ...exportLimiters,
};