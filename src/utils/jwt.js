const jwt = require("jsonwebtoken");
const crypto = require("crypto");
require("dotenv").config();

const ACCESS_SECRET = process.env.ACCESS_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;
const OTP_SECRET = process.env.OTP_SECRET;
const PIN_SECRET = process.env.PIN_SECRET;
const TRANSACTION_OTP_SECRET = process.env.TRANSACTION_OTP_SECRET;
const RESET_SECRET = process.env.RESET_SECRET;

const LOGIN_OTP_PURPOSE = "login_otp";
const PIN_VERIFIED_PURPOSE = "pin_verified";
const TRANSACTION_OTP_PURPOSE = "transaction_otp";
const FORGOT_KYC_PURPOSE = "forgot_kyc";

// Kiểm tra khóa bí mật có tồn tại không.
// Nếu thiếu biến môi trường thì báo lỗi rõ ràng, tránh ký token bằng khóa rỗng.
function requireSecret(secret, name) {
  if (!secret) {
    throw new Error(`Thiếu biến khóa bí mật ${name}`);
  }
  return secret;
}

const tokenUtil = {
  // Tên cookie lưu refresh token của merchant (môi trường thật và sandbox)
  MERCHANT_REFRESH_COOKIE: "merchant_refresh_token",
  MERCHANT_SANDBOX_REFRESH_COOKIE: "merchant_sandbox_refresh_token",

  // Tạo mã định danh phiên dài 16 ký tự.
  // Băm SHA-256 refresh token rồi lấy 16 ký tự đầu. Dùng làm "sid" trong access token
  // để gắn access token với đúng phiên đăng nhập, mà không lộ refresh token thật.
  getSessionId(refreshToken) {
    return crypto
      .createHash("sha256")
      .update(String(refreshToken))
      .digest("hex")
      .slice(0, 16);
  },

  // Băm token dài 64 ký tự (SHA-256, một chiều).
  // Dùng để lưu hash của refresh token vào DB thay vì lưu token thật,
  // khi cần kiểm tra thì băm token client gửi lên rồi so với hash trong DB.
  hashToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
  },

  // Tạo cặp access token (15 phút) và refresh token (7 ngày) khi đăng nhập.
  // Access token có thêm "sid" lấy từ refresh token nên phải tạo refresh token trước.
  generateAuthTokens(user) {
    const payload = {
      user_id: user.id,
      phone: user.phone,
      full_name: user.full_name,
      type: user.role,
    };

    const refreshToken = jwt.sign(
      payload,
      requireSecret(REFRESH_SECRET, "REFRESH_SECRET"),
      { expiresIn: "7d", algorithm: "HS256" },
    );

    const accessToken = jwt.sign(
      { ...payload, sid: tokenUtil.getSessionId(refreshToken) },
      requireSecret(ACCESS_SECRET, "ACCESS_SECRET"),
      { expiresIn: "15m", algorithm: "HS256" },
    );
    return {
      accessToken,
      refreshToken,
    };
  },

  // Xác thực access token: kiểm tra chữ ký, hạn dùng, chỉ chấp nhận HS256.
  // Trả về payload nếu hợp lệ, ném lỗi nếu sai hoặc hết hạn.
  verifyAccessToken(accessToken) {
    return jwt.verify(
      accessToken,
      requireSecret(ACCESS_SECRET, "ACCESS_SECRET"),
      { algorithms: ["HS256"] },
    );
  },

  // Xác thực refresh token (dùng khi client xin cấp access token mới).
  // Kiểm tra giống access token nhưng dùng khóa REFRESH_SECRET.
  verifyRefreshToken(refreshToken) {
    return jwt.verify(
      refreshToken,
      requireSecret(REFRESH_SECRET, "REFRESH_SECRET"),
      { algorithms: ["HS256"] },
    );
  },

  // Tạo OTP token (hạn 5 phút): bằng chứng "user đã được gửi OTP",
  // gắn với một mục đích (mặc định là đăng nhập). "extra" để nhét thêm dữ liệu tùy bước.
  generateOtpToken(user, purpose = LOGIN_OTP_PURPOSE, extra = {}) {
    const payload = {
      ...extra,
      user_id: user.id,
      phone: user.phone,
      email: user.email,
      purpose: purpose,
    };
    return jwt.sign(payload, OTP_SECRET, {
      expiresIn: "5m",
      algorithm: "HS256",
    });
  },

  // Xác thực OTP token và kiểm tra đúng mục đích (purpose) mong đợi.
  // Sai mục đích thì ném lỗi, tránh dùng OTP của bước này cho bước khác.
  verifyOtpToken(otpToken, expectedPurpose = LOGIN_OTP_PURPOSE) {
    const payload = jwt.verify(otpToken, OTP_SECRET, { algorithms: ["HS256"] });
    if (payload.purpose !== expectedPurpose) {
      const err = new Error("Phương thức otp không chính xác");
      err.name = "JsonWebTokenError";
      throw err;
    }
    return payload;
  },

  // Token cho bước chụp CCCD + khuôn mặt (quên mật khẩu), hạn 15 phút.
  // Cấp sau khi nhập đúng OTP email, chứng minh user đã qua bước OTP.
  generateForgotKycToken({ userId, type }) {
    return jwt.sign(
      { user_id: userId, type, purpose: FORGOT_KYC_PURPOSE },
      requireSecret(RESET_SECRET, "RESET_SECRET"),
      { expiresIn: "15m", algorithm: "HS256" },
    );
  },

  // Xác thực token KYC ở trên và kiểm tra đúng purpose "forgot_kyc"
  verifyForgotKycToken(token) {
    const payload = jwt.verify(token, requireSecret(RESET_SECRET, "RESET_SECRET"), {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== FORGOT_KYC_PURPOSE) {
      const err = new Error("Mã xác thực không đúng loại");
      err.name = "JsonWebTokenError";
      throw err;
    }
    return payload;
  },

  // Tạo "phiên bản" của mật khẩu/PIN: băm hash hiện tại rồi lấy 32 ký tự đầu.
  // Nhúng vào reset token (trường "pv"); sau khi đổi mật khẩu/PIN thì phiên bản đổi,
  // nên reset token cũ không còn dùng lại được.
  credentialVersion(hash) {
    return crypto
      .createHash("sha256")
      .update(String(hash ?? ""))
      .digest("hex")
      .slice(0, 32);
  },

  // Tạo token đặt lại mật khẩu hoặc PIN (hạn 10 phút).
  // purpose: "reset_password" | "reset_pin"
  generateResetToken({ userId, purpose, version }) {
    return jwt.sign(
      { user_id: userId, purpose, pv: version },
      requireSecret(RESET_SECRET, "RESET_SECRET"),
      { expiresIn: "10m", algorithm: "HS256" },
    );
  },

  // Xác thực reset token và kiểm tra đúng loại (đặt lại mật khẩu hay PIN).
  // Lưu ý: nơi gọi nên so thêm "pv" với credentialVersion hiện tại để chặn token đã dùng.
  verifyResetToken(token, expectedPurpose) {
    const payload = jwt.verify(token, requireSecret(RESET_SECRET, "RESET_SECRET"), {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== expectedPurpose) {
      const err = new Error("Mã xác thực không đúng loại");
      err.name = "JsonWebTokenError";
      throw err;
    }
    return payload;
  },

  // Tạo token xác nhận OTP cho giao dịch (hạn 5 phút).
  // action + binding: OTP chỉ có giá trị cho đúng loại giao dịch và đúng nội dung
  // (số tiền, người nhận...) đã được ký vào token lúc verify OTP, giống PIN token.
  // idempotencyKey gắn token với đúng một yêu cầu giao dịch, tránh dùng lại.
  generateTransactionOtpToken({ user, idempotencyKey, action, binding }) {
    const payload = {
      user_id: user.id,
      phone: user.phone,
      idempotency_key: idempotencyKey,
      action,
      binding,
      purpose: TRANSACTION_OTP_PURPOSE,
    };
    return jwt.sign(
      payload,
      requireSecret(TRANSACTION_OTP_SECRET, "TRANSACTION_OTP_SECRET"),
      { expiresIn: "5m", algorithm: "HS256" },
    );
  },

  // Xác thực token OTP giao dịch và kiểm tra đúng purpose "transaction_otp".
  // Nơi gọi cần so tiếp action/binding/idempotency_key với giao dịch đang thực hiện.
  verifyTransactionOtpToken(otpToken) {
    const payload = jwt.verify(
      otpToken,
      requireSecret(TRANSACTION_OTP_SECRET, "TRANSACTION_OTP_SECRET"),
      { algorithms: ["HS256"] },
    );
    if (payload.purpose !== TRANSACTION_OTP_PURPOSE) {
      const err = new Error("Mã xác thực OTP không đúng loại");
      err.name = "JsonWebTokenError";
      throw err;
    }
    return payload;
  },

  // Tạo token "đã nhập đúng PIN" (hạn 3 phút), cấp sau khi user xác nhận PIN.
  // Cũng gắn với action + binding + idempotencyKey nên chỉ dùng được cho đúng giao dịch đó.
  generatePinToken({ userId, idempotencyKey, action, binding }) {
    const payload = {
      user_id: userId,
      idempotency_key: idempotencyKey,
      action,
      binding,
      purpose: PIN_VERIFIED_PURPOSE,
    };
    return jwt.sign(payload, requireSecret(PIN_SECRET, "PIN_SECRET"), {
      expiresIn: "3m",
      algorithm: "HS256",
    });
  },

  // Xác thực PIN token và kiểm tra đúng purpose "pin_verified".
  // Nơi gọi cần so tiếp action/binding/idempotency_key với giao dịch đang thực hiện.
  verifyPinToken(pinToken) {
    const payload = jwt.verify(
      pinToken,
      requireSecret(PIN_SECRET, "PIN_SECRET"),
      {
        algorithms: ["HS256"],
      },
    );
    if (payload.purpose !== PIN_VERIFIED_PURPOSE) {
      const err = new Error("Mã xác thực PIN không đúng loại");
      err.name = "JsonWebTokenError";
      throw err;
    }
    return payload;
  },
};
module.exports = tokenUtil;