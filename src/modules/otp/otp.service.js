const otpRepository = require("./otp.repository");
const { uuidv7 } = require("uuidv7");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { sendOtp, verifyOtp } = require("../../services/twilio.service");
const otpService = {
  async generateAndSaveOtp({ email }) {
    if (!email) {
      const err = new Error("Thiếu email");
      err.statusCode = 400;
      throw err;
    }
    const expiredMinutes = 5;
    const existing = await otpRepository.findExistingOtp({ email });
    const otp = crypto.randomInt(100000, 1000000).toString();
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(otp, salt);

    if (existing) {
      await otpRepository.updateOtp({
        email,
        otpHash,
        expiredMinutes,
      });
    } else {
      const id = uuidv7();
      await otpRepository.createOtp({
        id,
        email,
        otpHash,
        expiredMinutes,
      });
    }
  },

  async verifyOtp({ email, otp }) {
    if (!email) {
      const err = new Error("Thiếu email");
      err.statusCode = 400;
      throw err;
    }
    const record = await otpRepository.findOtp({ email });
    if (!record) {
      const err = new Error("Không tìm thấy mã OTP");
      err.statusCode = 404;
      throw err;
    }

    if (record.expired_at && new Date(record.expired_at) <= new Date()) {
      const err = new Error("Mã OTP đã hết hạn");
      err.statusCode = 400;
      throw err;
    }

    if (record.locked_until && new Date(record.locked_until) >= new Date()) {
      const err = new Error(
        "Tài khoản bị tạm khóa. Vui lòng thử lại sau 5 phút",
      );
      err.statusCode = 403;
      throw err;
    }

    let currentAttempts = Number(record.failed_attempts);
    if (record.locked_until && new Date(record.locked_until) < new Date()) {
      currentAttempts = 0;
    }
    const attempts = currentAttempts + 1;
    const otpHash = record.otp_hash;
    const isMatch = await bcrypt.compare(otp, otpHash);

    if (!isMatch) {
      if (attempts >= 5) {
        const lockMinutes = 5;
        await otpRepository.lockAccount({
          phone,
          email,
          attempts,
          lockMinutes,
        });
        const err = new Error(
          "Bạn đã nhập sai 5 lần. Tài khoản bị tạm khóa 5 phút",
        );
        err.statusCode = 403;
        throw err;
      } else {
        await otpRepository.updateFailedAttempts({ email, attempts });
      }
      const err = new Error(
        `Mã OTP không chính xác. Bạn còn ${5 - attempts} lần thử.`,
      );
      err.statusCode = 400;
      throw err;
    }
    await otpRepository.markAsUsed({ email });
    return {
      email: email,
    };
  },

  async sendOtpByTwilio({ phone }) {
    if (!phone) {
      const err = new Error("Thiếu số điện thoại");
      err.statusCode = 400;
      throw err;
    }
    await sendOtp(phone);
  },

  async verifyOtpByTwilio({ phone, code }) {
    if (!phone || !code) {
      const err = new Error("Thiếu số điện thoại hoặc mã xác thực");
      err.statusCode = 400;
      throw err;
    }
    const result = await verifyOtp(phone, code);
    if (result.valid) {
      return {
        phone: phone,
      };
    }
    const err = new Error("Mã xác thực không chính xác");
    err.statusCode = 400;
    throw err;
  },
};
module.exports = otpService;
