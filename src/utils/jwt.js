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

function requireSecret(secret, name) {
  if (!secret) {
    throw new Error(`Thiếu biến môi trường ${name}`);
  }
  return secret;
}

const tokenUtil = {
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

  generateOtpToken(user, purpose = LOGIN_OTP_PURPOSE) {
    const payload = {
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

  generateTransactionOtpToken({ user, idempotencyKey }) {
    const payload = {
      user_id: user.id,
      phone: user.phone,
      idempotency_key: idempotencyKey,
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

  generatePinToken({ userId, idempotencyKey }) {
    const payload = {
      user_id: userId,
      idempotency_key: idempotencyKey,
      purpose: PIN_VERIFIED_PURPOSE,
    };
    return jwt.sign(payload, requireSecret(PIN_SECRET, "PIN_SECRET"), {
      expiresIn: "3m",
      algorithm: "HS256",
    });
  },

  verifyPinToken(pinToken) {
    const payload = jwt.verify(pinToken, requireSecret(PIN_SECRET, "PIN_SECRET"), {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== PIN_VERIFIED_PURPOSE) {
      const err = new Error("Mã xác thực PIN không đúng loại");
      err.name = "JsonWebTokenError";
      throw err;
    }
    return payload;
  },
};
module.exports = tokenUtil;