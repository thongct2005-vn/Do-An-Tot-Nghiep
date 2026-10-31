const merchantOtpRepository = require("./otp.repository");
const { uuidv7 } = require("uuidv7");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const { sendOtpEmail } = require("../../../../utils/mailer");

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
const OTP_EXPIRE_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const OTP_PATTERN = /^\d{6}$/;

const { httpError } = require("../../../../utils/httpError");

function detectChannel({ email, phone }) {
  if (email && phone) {
    throw httpError(
      400,
      "Chỉ được chọn một trong hai: email hoặc số điện thoại",
    );
  }
  if (email) return { channel: "email", identifier: email };
  if (phone) return { channel: "phone", identifier: phone };

  throw httpError(400, "Thiếu email hoặc số điện thoại");
}

const merchantOtpService = {
  async generateAndSaveOtp({ email, phone }) {
    const { channel, identifier } = detectChannel({ email, phone });

    const existing = await merchantOtpRepository.findExistingOtp({
      channel,
      identifier,
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
          RESEND_COOLDOWN_SECONDS * 1000
      ) {
        throw httpError(429, "Vui lòng đợi một lúc trước khi yêu cầu mã mới");
      }
    }

    const otp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    const otpHash = await bcrypt.hash(otp, 10);

    if (existing) {
      await merchantOtpRepository.updateOtp({
        channel,
        identifier,
        otpHash,
        expiredMinutes: OTP_EXPIRE_MINUTES,
      });
    } else {
      await merchantOtpRepository.createOtp({
        id: uuidv7(),
        channel,
        identifier,
        otpHash,
        expiredMinutes: OTP_EXPIRE_MINUTES,
      });
    }

    if (channel === "email") {
      await sendOtpEmail({
        to: identifier,
        otp,
        expiresInMinutes: OTP_EXPIRE_MINUTES,
      });
    }

    return {
      [channel]: identifier,
    };
  },

  async verifyOtp({ email, otp }) {
    const { channel, identifier } = detectChannel({ email });

    const code = String(otp ?? "");
    if (!OTP_PATTERN.test(code)) {
      throw httpError(400, "Mã OTP không hợp lệ");
    }

    const record = await merchantOtpRepository.findOtp({ channel, identifier });
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
      const row = await merchantOtpRepository.registerFailedAttempt({
        channel,
        identifier,
        maxAttempts: MAX_FAILED_ATTEMPTS,
        lockMinutes: LOCK_MINUTES,
      });
      const attempts = Number(row?.failed_attempts ?? MAX_FAILED_ATTEMPTS);

      if (attempts >= MAX_FAILED_ATTEMPTS) {
        throw httpError(
          403,
          `Bạn đã nhập sai ${MAX_FAILED_ATTEMPTS} lần. Tài khoản bị tạm khóa ${LOCK_MINUTES} phút`,
        );
      }

      const remainingAttempts = MAX_FAILED_ATTEMPTS - attempts;
      throw httpError(
        400,
        `Mã OTP không chính xác. Bạn còn ${remainingAttempts} lần thử`,
      );
    }

    const consumed = await merchantOtpRepository.consumeOtp({ channel, identifier });
    if (!consumed) {
      throw httpError(400, "Mã OTP đã được sử dụng hoặc hết hạn");
    }

    return { [channel]: identifier };
  },
};

module.exports = merchantOtpService;
