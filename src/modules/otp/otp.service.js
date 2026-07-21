const otpRepository = require("./otp.repository");
const { uuidv7 } = require("uuidv7");
const bcrypt = require("bcrypt");

const otpService = {
  async generateAndSaveOtp({ identifier, purpose }) {
    const isEmail = identifier.includes("@");
    const phone = isEmail ? null : identifier;
    const email = isEmail ? identifier : null;
    const expiredMinutes = 5;
    const existing = await otpRepository.findExistingOtp({ phone, email });
    const otp = "aptx4869";
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(otp, salt);

    if (existing) {
      await otpRepository.updateOtp({
        phone,
        email,
        otpHash,
        purpose,
        expiredMinutes,
      });
    } else {
      const id = uuidv7();
      await otpRepository.createOtp({
        id,
        phone,
        email,
        otpHash,
        purpose,
        expiredMinutes,
      });
    }
  },

  async verifyOtp({ identifier, otp, purpose }) {
    const isEmail = identifier.includes("@");
    const phone = isEmail ? null : identifier;
    const email = isEmail ? identifier : null;
    const record = await otpRepository.findOtp({ phone, email, purpose });
    if (!record) {
      const err = new Error("Không tìm thấy mã OTP");
      err.statusCode = 404;
      throw err;
    }

    if (record.expired_at && new Date(record.expired_at) <= new Date()) {
      const err = new Error("Mã OTP đã hết hạn");
      err.statusCode = 401;
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
        await otpRepository.updateFailedAttempts({ phone, email, attempts });
      }
      const err = new Error(
        `Mã OTP không chính xác. Bạn còn ${5 - attempts} lần thử.`,
      );
      err.statusCode = 401;
      throw err;
    }
    await otpRepository.markAsUsed({ phone, email });
  },
};
module.exports = otpService;
