const otpRepository = require('./otp.repository');
const { uuidv7 } = require('uuidv7');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
const OTP_EXPIRE_MINUTES = 5;

function detectChannel({ email, phone }) {
  if (email && phone) {
    const err = new Error('Chỉ được chọn một trong hai: email hoặc số điện thoại');
    err.statusCode = 400;
    throw err;
  }
  if (email) return { channel: 'email', identifier: email };
  if (phone) return { channel: 'phone', identifier: phone };

  const err = new Error('Thiếu email hoặc số điện thoại');
  err.statusCode = 400;
  throw err;
}

const otpService = {
  async generateAndSaveOtp({ email, phone }) {
    const { channel, identifier } = detectChannel({ email, phone });

    const existing = await otpRepository.findExistingOtp({ channel, identifier });
    const otp = crypto.randomInt(1000, 9999).toString();
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(otp, salt);

    if (existing) {
      await otpRepository.updateOtp({
        channel,
        identifier,
        otpHash,
        expiredMinutes: OTP_EXPIRE_MINUTES,
      });
    } else {
      const id = uuidv7();
      await otpRepository.createOtp({
        id,
        channel,
        identifier,
        otpHash,
        expiredMinutes: OTP_EXPIRE_MINUTES,
      });
    }

    const label = channel === 'email' ? 'Email' : 'Số điện thoại';
    console.log(`\n${label}: ${identifier} - Mã OTP: ${otp}\n`);

    return {
      [channel]: identifier,
      debug_otp: process.env.NODE_ENV === 'development' ? otp : undefined,
    };
  },

  async verifyOtp({ email, phone, otp }) {
    const { channel, identifier } = detectChannel({ email, phone });

    if (!otp) {
      const err = new Error('Thiếu mã OTP');
      err.statusCode = 400;
      throw err;
    }

    const record = await otpRepository.findOtp({ channel, identifier });
    if (!record) {
      const err = new Error('Không tìm thấy mã OTP');
      err.statusCode = 404;
      throw err;
    }

    if (record.locked_until && new Date(record.locked_until) > new Date()) {
      const err = new Error('Tài khoản bị tạm khóa. Vui lòng thử lại sau');
      err.statusCode = 403;
      throw err;
    }

    if (record.expired_at && new Date(record.expired_at) <= new Date()) {
      const err = new Error('Mã OTP đã hết hạn');
      err.statusCode = 400;
      throw err;
    }

    let currentAttempts = Number(record.failed_attempts);
    if (record.locked_until && new Date(record.locked_until) <= new Date()) {
      currentAttempts = 0;
    }

    const isMatch = await bcrypt.compare(otp, record.otp_hash);

    if (!isMatch) {
      const attempts = currentAttempts + 1;

      if (attempts >= MAX_FAILED_ATTEMPTS) {
        await otpRepository.lockAccount({
          channel,
          identifier,
          attempts,
          lockMinutes: LOCK_MINUTES,
        });
        const err = new Error(
          `Bạn đã nhập sai ${MAX_FAILED_ATTEMPTS} lần. Tài khoản bị tạm khóa ${LOCK_MINUTES} phút`,
        );
        err.statusCode = 403;
        throw err;
      }

      await otpRepository.updateFailedAttempts({ channel, identifier, attempts });
      const err = new Error(
        `Mã OTP không chính xác. Bạn còn ${MAX_FAILED_ATTEMPTS - attempts} lần thử`,
      );
      err.statusCode = 400;
      throw err;
    }

    await otpRepository.markAsUsed({ channel, identifier });
    return { [channel]: identifier };
  },
};

module.exports = otpService;