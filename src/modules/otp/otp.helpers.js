// otp.helpers.js: Hằng số chính sách và hàm chuẩn hóa email cho nghiệp vụ OTP email.
const { httpError } = require("../../utils/common/http");

const OTP_POLICY = Object.freeze({
  MAX_FAILED_ATTEMPTS: 5,
  LOCK_MINUTES: 5,
  EXPIRE_MINUTES: 5,
  RESEND_COOLDOWN_SECONDS: 60,
});

const OTP_PATTERN = /^\d{6}$/;

function requireEmail(email) {
  const normalized = typeof email === "string" ? email.trim() : "";
  if (!normalized) {
    throw httpError(400, "Thiếu email");
  }
  return normalized;
}

module.exports = {
  OTP_POLICY,
  OTP_PATTERN,
  requireEmail,
};

