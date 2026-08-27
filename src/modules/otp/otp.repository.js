const pool = require('../../config/database');
const ALLOWED_CHANNELS = {
  email: 'email',
  phone: 'phone',
};

function resolveColumn(channel) {
  const column = ALLOWED_CHANNELS[channel];
  if (!column) {
    const err = new Error('Kênh xác thực không hợp lệ');
    err.statusCode = 400;
    throw err;
  }
  return column;
}

const otpRepository = {
  async findOtp({ channel, identifier }) {
    const column = resolveColumn(channel);
    const result = await pool.query(
      `SELECT * FROM otp_tracking WHERE used_at IS NULL AND ${column} = $1`,
      [identifier],
    );
    return result.rows[0];
  },

  async findExistingOtp({ channel, identifier }) {
    const column = resolveColumn(channel);
    const result = await pool.query(
      `SELECT id FROM otp_tracking WHERE ${column} = $1`,
      [identifier],
    );
    return result.rows[0];
  },

  async createOtp({ id, channel, identifier, otpHash, expiredMinutes }) {
    const column = resolveColumn(channel);
    await pool.query(
      `INSERT INTO otp_tracking(id, ${column}, otp_hash, expired_at, failed_attempts, locked_until, used_at, created_at)
       VALUES ($1, $2, $3, NOW() + ($4::TEXT || ' minutes')::INTERVAL, 0, NULL, NULL, NOW())`,
      [id, identifier, otpHash, expiredMinutes],
    );
  },

  async updateOtp({ channel, identifier, otpHash, expiredMinutes }) {
    const column = resolveColumn(channel);
    await pool.query(
      `UPDATE otp_tracking SET otp_hash = $1, expired_at = NOW() + ($2::TEXT || ' minutes')::INTERVAL,
       failed_attempts = 0, locked_until = NULL, used_at = NULL, created_at = NOW()
       WHERE ${column} = $3`,
      [otpHash, expiredMinutes, identifier],
    );
  },

  async updateFailedAttempts({ channel, identifier, attempts }) {
    const column = resolveColumn(channel);
    await pool.query(
      `UPDATE otp_tracking SET failed_attempts = $1 WHERE ${column} = $2`,
      [attempts, identifier],
    );
  },

  async lockAccount({ channel, identifier, attempts, lockMinutes }) {
    const column = resolveColumn(channel);
    await pool.query(
      `UPDATE otp_tracking SET failed_attempts = $1, locked_until = NOW() + ($2::TEXT || ' minutes')::INTERVAL WHERE ${column} = $3`,
      [attempts, lockMinutes, identifier],
    );
  },

  async markAsUsed({ channel, identifier }) {
    const column = resolveColumn(channel);
    await pool.query(
      `UPDATE otp_tracking SET used_at = NOW() WHERE ${column} = $1`,
      [identifier],
    );
  },
};

module.exports = otpRepository;