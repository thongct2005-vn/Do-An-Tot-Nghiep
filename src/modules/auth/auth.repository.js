const pool = require("../../config/database");
const tokenUtil = require("../../utils/jwt");
const authRepository = {
  async findUserByPhone(phone) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role
      FROM users u
      WHERE u.phone = $1
      `,
      [phone],
    );
    return result.rows[0];
  },

  async findUserByEmail(email) {
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

  async resetFailedLogin(phone) {
    await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 0, locked_until = NULL
      WHERE phone = $1
      `,
      [phone],
    );
  },

  async registerFailedLogin({ phone, maxAttempts, lockMinutes }) {
    const result = await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
          locked_until = CASE
            WHEN COALESCE(failed_login_attempts, 0) + 1 >= $2::INT
            THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
            ELSE locked_until
          END
      WHERE phone = $1
      RETURNING failed_login_attempts
      `,
      [phone, maxAttempts, lockMinutes],
    );
    return result.rows[0];
  },

  async updateRefeshToken({ refreshToken, userId }) {
    await pool.query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [
      tokenUtil.hashToken(refreshToken),
      userId,
    ]);
  },

  async findUserByRefreshToken(refreshToken) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.balance
      FROM users u
      WHERE u.refresh_token = $1
      `,
      [tokenUtil.hashToken(refreshToken)],
    );
    return result.rows[0];
  },

  async addUser({ userId, phone, phoneHash, email, passwordHash }) {
    await pool.query(
      `
      INSERT INTO users(id, phone, phone_hash, email, password_hash)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, phone, phoneHash, email, passwordHash],
    );
  },

  async logout(userId) {
    await pool.query(
      "UPDATE users SET refresh_token = $1, fcm_token = $2 WHERE id = $3",
      [null, null, userId],
    );
  },
};

module.exports = authRepository;