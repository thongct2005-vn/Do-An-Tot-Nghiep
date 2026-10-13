const jwt = require("jsonwebtoken");
require("dotenv").config();
const ACCESS_SECRET = process.env.ACCESS_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;
const OTP_SECRET = process.env.OTP_SECRET;
const LOGIN_OTP_PURPOSE = "login_otp";
const REGISTER_OTP_PURPOSE = "register_otp";

const tokenUtil = {
  generateAuthTokens(user) {
    const payload = {
      user_id: user.id,
      phone: user.phone,
      full_name: user.full_name,
      wallet_id: user.wallet_id,
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
};
module.exports = tokenUtil;