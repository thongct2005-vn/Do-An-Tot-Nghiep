const pool = require("../../config/database");
const authRepository = {
  async findUserByPhone(phone) {
    const result = await pool.query(
      `
            SELECT u.id , u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts, u.locked_until, (u.locked_until > NOW()) AS is_locked, w.id AS wallet_id
            FROM users u
            LEFT JOIN wallets w 
            ON u.id = w.user_id
            WHERE phone = $1
            `,
      [phone],
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

  async updateFailedLogin({ phone, attempts, lockMinutes = 0 }) {
    await pool.query(
      `
            UPDATE users
            SET failed_login_attempts = $2,
            locked_until = CASE
            WHEN $3::INT > 0 THEN NOW() + ($3::TEXT || ' minutes'):: INTERVAL
                ELSE locked_until
            END
            WHERE phone = $1
            `,
      [phone, attempts, lockMinutes],
    );
  },

  async updateRefeshToken({ refreshToken, userId }) {
    await pool.query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [
      refreshToken,
      userId,
    ]);
  },

  async findUserByRefreshToken(refreshToken) {
    const result = await pool.query(
      `SELECT id, phone, full_name  FROM users WHERE refresh_token = $1`,
      [refreshToken],
    );
    return result.rows[0];
  },

  async addUser({ userId, walletId, phone, phoneHash, passwordHash }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
            INSERT INTO users(id, phone, phone_hash, password_hash,)
            VALUES ($1, $2, $3, $4)
            `,
        [userId, phone, phoneHash, passwordHash],
      );

      await client.query(
        `
            INSERT INTO wallets(id, user_id)
            VALUES ($1, $2)
            `,
        [walletId, userId],
      );

      await client.query(
        `
            INSERT INTO wallet_balances(wallet_id)
            VALUES ($1)
            `,
        [walletId],
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async logout(userId) {
    await pool.query("UPDATE users SET refresh_token = $1, fcm_token = $2 WHERE id = $3", [
      null,
      null,
      userId
    ]);
  },
};

module.exports = authRepository;
