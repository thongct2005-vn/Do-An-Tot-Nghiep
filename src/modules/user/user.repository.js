const pool = require("../../config/database");

const userRepository = {
  async findUserByPhone(phone) {
    const result = await pool.query(
      `SELECT id, phone, full_name FROM users WHERE phone = $1 AND status = 'ACTIVE'`,
      [phone],
    );
    return result.rows[0];
  },

  async getUserByUserId(userId) {
    const result = await pool.query(
      `
        SELECT u.id AS user_id, u.role, u.full_name, u.phone, u.status AS user_status, u.call_back_url, u.api_key, u.balance, u.secret_key
        FROM users u
        WHERE u.id = $1
        `,
      [userId],
    );

    return result?.rows[0] ?? null;
  },

  async findUserByPhoneHashList(phones) {
    const result = await pool.query(
      `SELECT id, phone_hash, full_name FROM users WHERE phone_hash = ANY($1) AND status = 'ACTIVE'`,
      [phones],
    );
    return result.rows;
  },

  async checkPinStatus(userId) {
    const result = await pool.query(
      `SELECT pin_hash FROM users WHERE id = $1 `,
      [userId],
    );
    return result.rows[0];
  },


  async getPinState(userId) {
    const result = await pool.query(
      `SELECT pin_hash,
              COALESCE(pin_failed_attempts, 0) AS pin_failed_attempts,
              pin_locked_until,
              (pin_locked_until > NOW()) AS is_locked
       FROM users WHERE id = $1`,
      [userId],
    );
    return result.rows[0];
  },

  async registerFailedPin({ userId, maxAttempts, lockMinutes }) {
    const result = await pool.query(
      `UPDATE users
       SET pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
           pin_locked_until = CASE
             WHEN COALESCE(pin_failed_attempts, 0) + 1 >= $2::INT
             THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
             ELSE pin_locked_until
           END
       WHERE id = $1
       RETURNING pin_failed_attempts`,
      [userId, maxAttempts, lockMinutes],
    );
    return result.rows[0];
  },

  async resetFailedPin(userId) {
    await pool.query(
      `UPDATE users SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`,
      [userId],
    );
  },

  async createPin({ userId, pinHash }) {
    const result = await pool.query(
      `UPDATE users SET pin_hash = $1 WHERE id = $2 AND pin_hash IS NULL RETURNING id`,
      [pinHash, userId],
    );
    return result.rows[0];
  },

  async updateFmcToken({ userId, fcmToken }) {
    await pool.query(`UPDATE users SET fcm_token = $1 WHERE id = $2`, [
      fcmToken,
      userId,
    ]);
  },

  async getFcmToken(userId) {
    const result = await pool.query(
      `SELECT fcm_token FROM users WHERE id = $1`,
      [userId],
    );
    return result.rows[0]?.fcm_token || null;
  },
};
module.exports = userRepository;