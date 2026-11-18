const pool = require("../../config/database");

const otpRepository = {
  async findOtp({ email }) {
    const result = await pool.query(
      `SELECT id, email, otp_hash, failed_attempts, locked_until, expired_at, used_at, created_at
         FROM otp_tracking
        WHERE used_at IS NULL AND email = $1`,
      [email],
    );
    return result.rows[0];
  },

  async findExistingOtp({ email }) {
    const result = await pool.query(
      `SELECT id, created_at, locked_until, used_at
         FROM otp_tracking
        WHERE email = $1`,
      [email],
    );
    return result.rows[0];
  },

  async createOtp({ id, email, otpHash, expiredMinutes }) {
    await pool.query(
      `INSERT INTO otp_tracking(id, email, otp_hash, expired_at, failed_attempts, locked_until, used_at, created_at)
       VALUES ($1, $2, $3, NOW() + ($4::TEXT || ' minutes')::INTERVAL, 0, NULL, NULL, NOW())
       ON CONFLICT (email) DO UPDATE SET
         otp_hash = EXCLUDED.otp_hash,
         expired_at = EXCLUDED.expired_at,
         failed_attempts = 0,
         locked_until = NULL,
         used_at = NULL,
         created_at = NOW()`,
      [id, email, otpHash, expiredMinutes],
    );
  },

  async updateOtp({ email, otpHash, expiredMinutes }) {
    await pool.query(
      `UPDATE otp_tracking
          SET otp_hash = $1,
              expired_at = NOW() + ($2::TEXT || ' minutes')::INTERVAL,
              failed_attempts = 0,
              locked_until = NULL,
              used_at = NULL,
              created_at = NOW()
        WHERE email = $3`,
      [otpHash, expiredMinutes, email],
    );
  },

  async registerFailedAttempt({ email, maxAttempts, lockMinutes }) {
    const result = await pool.query(
      `UPDATE otp_tracking
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE
                WHEN failed_attempts + 1 >= $2
                THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
                ELSE locked_until
              END
        WHERE email = $1 AND used_at IS NULL
        RETURNING failed_attempts`,
      [email, maxAttempts, lockMinutes],
    );
    return result.rows[0];
  },

  async consumeOtp({ email }) {
    const result = await pool.query(
      `UPDATE otp_tracking
          SET used_at = NOW()
        WHERE email = $1
          AND used_at IS NULL
          AND expired_at > NOW()
          AND (locked_until IS NULL OR locked_until <= NOW())
        RETURNING id`,
      [email],
    );
    return result.rowCount === 1;
  },
};

module.exports = otpRepository;
