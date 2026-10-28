const jwt = require("jsonwebtoken");
const crypto = require("crypto");
require("dotenv").config();
const ACCESS_SECRET = process.env.ACCESS_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;
const OTP_SECRET = process.env.OTP_SECRET;
const LOGIN_OTP_PURPOSE = "login_otp";
const PIN_VERIFIED_PURPOSE = "pin_verified";
const TRANSACTION_OTP_PURPOSE = "transaction_otp";
const PIN_SECRET = process.env.PIN_SECRET;
const TRANSACTION_OTP_SECRET = process.env.TRANSACTION_OTP_SECRET;
const RESET_SECRET = process.env.RESET_SECRET;
const FORGOT_KYC_PURPOSE = "forgot_kyc";

function requireSecret(secret, name) {
  if (!secret) {
    throw new Error(`Thiếu biến môi trường ${name}`);
  }
  return secret;
}

const tokenUtil = {
  MERCHANT_REFRESH_COOKIE: "merchant_refresh_token",
  MERCHANT_SANDBOX_REFRESH_COOKIE: "merchant_sandbox_refresh_token",

  hashToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
  },

  generateAuthTokens(user) {
    const payload = {
      user_id: user.id,
      phone: user.phone,
      full_name: user.full_name,
      type: user.role,
    };

    const accessToken = jwt.sign(payload, ACCESS_SECRET, { expiresIn: "15m" });
    const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: "7d" });
    return {
      accessToken,
      refreshToken,
    };
  },

  verifyAccessToken(accessToken) {
    return jwt.verify(accessToken, ACCESS_SECRET);
  },

  verifyRefreshToken(refreshToken) {
    return jwt.verify(refreshToken, REFRESH_SECRET);
  },

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

  verifyOtpToken(otpToken, expectedPurpose = LOGIN_OTP_PURPOSE) {
    const payload = jwt.verify(otpToken, OTP_SECRET, { algorithms: ["HS256"] });
    if (payload.purpose !== expectedPurpose) {
      const err = new Error("Phương thức otp không chính xác");
      err.name = "JsonWebTokenError";
      throw err;
    }
    return payload;
  },

  // Token cho bước chụp CCCD + khuôn mặt, cấp sau khi nhập đúng OTP email
  generateForgotKycToken({ userId, type }) {
    return jwt.sign(
      { user_id: userId, type, purpose: FORGOT_KYC_PURPOSE },
      requireSecret(RESET_SECRET, "RESET_SECRET"),
      { expiresIn: "15m", algorithm: "HS256" },
    );
  },

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

  // Dấu vân tay của hash hiện tại (mật khẩu hoặc PIN). Token đặt lại gắn với nó,
  // đổi xong thì hash đổi nên token chỉ dùng được một lần.
  credentialVersion(hash) {
    return crypto
      .createHash("sha256")
      .update(String(hash ?? ""))
      .digest("hex")
      .slice(0, 32);
  },

  // purpose: "reset_password" | "reset_pin"
  generateResetToken({ userId, purpose, version }) {
    return jwt.sign(
      { user_id: userId, purpose, pv: version },
      requireSecret(RESET_SECRET, "RESET_SECRET"),
      { expiresIn: "10m", algorithm: "HS256" },
    );
  },

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

  // action + binding: OTP chỉ có giá trị cho đúng loại giao dịch và đúng nội dung
  // (số tiền, người nhận...) đã được ký vào token lúc verify OTP, giống PIN token.
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