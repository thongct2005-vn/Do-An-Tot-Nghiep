const pool = require("../../config/database");
const tokenUtil = require("../../utils/jwt");
const authRepository = {
  async findUserByPhone(phone) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role,
             u.totp_enabled
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

  async getTotpState(userId) {
    const result = await pool.query(
      `
      SELECT totp_secret, totp_enabled, totp_last_step,
             (totp_locked_until > NOW()) AS is_totp_locked
      FROM users
      WHERE id = $1
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  // Chỉ ghi được khi chưa bật: đang bật thì không cho đè khoá bằng mật khẩu
  async saveTotpSecret({ userId, encryptedSecret }) {
    const result = await pool.query(
      `
      UPDATE users
      SET totp_secret = $1, totp_enabled = false, totp_last_step = NULL,
          totp_failed_attempts = 0, totp_locked_until = NULL
      WHERE id = $2 AND totp_enabled = false
      RETURNING id
      `,
      [encryptedSecret, userId],
    );
    return result.rows[0] ?? null;
  },

  async enableTotp(userId) {
    const result = await pool.query(
      `
      UPDATE users
      SET totp_enabled = true
      WHERE id = $1 AND totp_enabled = false AND totp_secret IS NOT NULL
      RETURNING id
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  async disableTotp(userId) {
    await pool.query(
      `
      UPDATE users
      SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL,
          totp_failed_attempts = 0, totp_locked_until = NULL
      WHERE id = $1
      `,
      [userId],
    );
  },

  // Ghi nhận bước đã dùng (chặn dùng lại cùng một mã) và xoá bộ đếm sai
  async consumeTotpStep({ userId, step }) {
    const result = await pool.query(
      `
      UPDATE users
      SET totp_last_step = $2, totp_failed_attempts = 0, totp_locked_until = NULL
      WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
      RETURNING id
      `,
      [userId, step],
    );
    return result.rowCount === 1;
  },

  async registerTotpFailure({ userId, maxAttempts, lockMinutes }) {
    const result = await pool.query(
      `
      UPDATE users
      SET totp_failed_attempts = n.attempts,
          totp_locked_until = CASE
            WHEN n.attempts >= $2::INT
            THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
            ELSE NULL
          END
      FROM (
        SELECT id,
               CASE
                 WHEN totp_locked_until IS NOT NULL AND totp_locked_until <= NOW() THEN 1
                 ELSE COALESCE(totp_failed_attempts, 0) + 1
               END AS attempts
        FROM users
        WHERE id = $1
      ) n
      WHERE users.id = n.id
      RETURNING users.totp_failed_attempts
      `,
      [userId, maxAttempts, lockMinutes],
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
      SELECT u.id, u.phone, u.full_name, u.balance, u.role
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