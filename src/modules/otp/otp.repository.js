const pool = require('../../config/database');

const otpRepository = {
  async findOtp({ email }) {
    const result = await pool.query(
      `SELECT * FROM otp_tracking WHERE used_at is null AND email = $1`,
      [email],
    );
    return result.rows[0];
  },

  async findExistingOtp({ email }) {
    const result = await pool.query(`SELECT id FROM otp_tracking WHERE`, [
      email,
    ]);
    return result.rows[0];
  },

  async createOtp({ id, email, otpHash, expiredMinutes }) {
    const query = `INSERT INTO otp_tracking(id, email, otp_hash,
              expired_at, failed_attempts, locked_until, used_at, created_at)
            VALUES ($1, $2, $3, NOW() + ($4::TEXT || ' minutes'):: INTERVAL, 0, NULL, NULL, NOW())
            `;

    await pool.query(query, [id, email, otpHash, expiredMinutes]);
  },

  async updateOtp({ email, otpHash, expiredMinutes }) {
    await pool.query(
      `UPDATE otp_tracking SET otp_hash = $1, expired_at = NOW() + ($2::TEXT || ' minutes')::INTERVAL,
    failed_attempts = 0, locked_until = null, used_at = null, created_at = NOW()
    WHERE email = $3
    `,
      [otpHash, expiredMinutes, email],
    );
  },

  async updateFailedAttempts({ email, attempts }) {
    await pool.query(
      `UPDATE otp_tracking SET failed_attempts = $1 WHERE email = $2`,
      [attempts, email],
    );
  },

  async lockAccount({ email, attempts, lockMinutes }) {
    await pool.query(
      `UPDATE otp_tracking SET failed_attempts = $1, locked_until = NOW() + ($2::TEXT || ' minutes')::INTERVAL WHERE email = $3`,
      [attempts, lockMinutes, email],
    );
  },

  async markAsUsed({ email }) {
    await pool.query(`UPDATE otp_tracking SET used_at = NOW() WHERE email = $1`, [email]);
  },
};

module.exports = otpRepository;
