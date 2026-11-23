// otp.service.js: Nghiệp vụ tạo, giới hạn gửi lại, khóa sai nhiều lần và xác thực mã OTP email.
const otpRepository = require("./otp.repository");
const { uuidv7 } = require("uuidv7");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { sendOtpEmail } = require("../../utils/notifications/mailer");
const { httpError } = require("../../utils/common/http");
const { OTP_POLICY, OTP_PATTERN, requireEmail } = require("./otp.helpers");

const otpService = {
  async generateAndSaveOtp({ email }) {
    const normalizedEmail = requireEmail(email);

    const existing = await otpRepository.findExistingOtp({
      email: normalizedEmail,
    });

    if (existing) {
      const now = Date.now();
      if (
        existing.locked_until &&
        new Date(existing.locked_until).getTime() > now
      ) {
        throw httpError(403, "Tạm khóa, vui lòng thử lại sau");
      }
      if (
        !existing.used_at &&
        now - new Date(existing.created_at).getTime() <
          OTP_POLICY.RESEND_COOLDOWN_SECONDS * 1000
      ) {
        throw httpError(429, "Vui lòng đợi một lúc trước khi yêu cầu mã mới");
      }
    }

    const otp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    const otpHash = await bcrypt.hash(otp, 10);

    if (existing) {
      await otpRepository.updateOtp({
        email: normalizedEmail,
        otpHash,
        expiredMinutes: OTP_POLICY.EXPIRE_MINUTES,
      });
    } else {
      await otpRepository.createOtp({
        id: uuidv7(),
        email: normalizedEmail,
        otpHash,
        expiredMinutes: OTP_POLICY.EXPIRE_MINUTES,
      });
    }

    await sendOtpEmail({
      to: normalizedEmail,
      otp,
      expiresInMinutes: OTP_POLICY.EXPIRE_MINUTES,
    });

    return {
      email: normalizedEmail,
    };
  },

  async verifyOtp({ email, otp }) {
    const normalizedEmail = requireEmail(email);

    const code = String(otp ?? "");
    if (!OTP_PATTERN.test(code)) {
      throw httpError(400, "Mã OTP không hợp lệ");
    }

    const record = await otpRepository.findOtp({ email: normalizedEmail });
    if (!record) {
      throw httpError(400, "Mã OTP không hợp lệ hoặc đã được sử dụng");
    }

    if (record.locked_until && new Date(record.locked_until) > new Date()) {
      throw httpError(403, "Tài khoản bị tạm khóa. Vui lòng thử lại sau");
    }

    if (record.expired_at && new Date(record.expired_at) <= new Date()) {
      throw httpError(400, "Mã OTP đã hết hạn");
    }

    const isMatch = await bcrypt.compare(code, record.otp_hash);
    if (!isMatch) {
      const row = await otpRepository.registerFailedAttempt({
        email: normalizedEmail,
        maxAttempts: OTP_POLICY.MAX_FAILED_ATTEMPTS,
        lockMinutes: OTP_POLICY.LOCK_MINUTES,
      });
      const attempts = Number(
        row?.failed_attempts ?? OTP_POLICY.MAX_FAILED_ATTEMPTS,
      );

      if (attempts >= OTP_POLICY.MAX_FAILED_ATTEMPTS) {
        throw httpError(
          403,
          `Bạn đã nhập sai ${OTP_POLICY.MAX_FAILED_ATTEMPTS} lần. Tài khoản bị tạm khóa ${OTP_POLICY.LOCK_MINUTES} phút`,
        );
      }

      const remainingAttempts = OTP_POLICY.MAX_FAILED_ATTEMPTS - attempts;
      throw httpError(
        400,
        `Mã OTP không chính xác. Bạn còn ${remainingAttempts} lần thử`,
      );
    }

    const consumed = await otpRepository.consumeOtp({ email: normalizedEmail });
    if (!consumed) {
      throw httpError(400, "Mã OTP đã được sử dụng hoặc hết hạn");
    }

    return { email: normalizedEmail };
  },
};

module.exports = otpService;
