const pool = require("../../config/database");

const adminAuthRepository = {
  async findAdminByEmail(email) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role
      FROM users u
      WHERE u.email = $1
      `,
      [email],
    );
    return result.rows[0];
  },

  async resetFailedLogin(email) {
    await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 0, locked_until = NULL
      WHERE email = $1
      `,
      [email],
    );
  },

  async registerFailedLogin({ email, maxAttempts, lockMinutes }) {
    const result = await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
          locked_until = CASE
            WHEN COALESCE(failed_login_attempts, 0) + 1 >= $2::INT
            THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
            ELSE locked_until
          END
      WHERE email = $1
      RETURNING failed_login_attempts
      `,
      [email, maxAttempts, lockMinutes],
    );
    return result.rows[0];
  },

  async updateRefreshToken({ refreshToken, userId }) {
    await pool.query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [
      refreshToken,
      userId,
    ]);
  },
};

module.exports = adminAuthRepository;
