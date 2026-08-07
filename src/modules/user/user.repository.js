const pool = require("../../config/database");

const userRepository = {
  async findUserByPhone(phone) {
    const result = await pool.query(
      `SELECT id, phone, full_name FROM users WHERE phone = $1`,
      [phone],
    );
    return result.rows[0];
  },

  async findUserByPhoneHashList(phones) {
    const result = await pool.query(
      `SELECT id, phone, full_name FROM users WHERE phone_hash = ANY($1)`,
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

  async getFcmToken(userId){
    const result = await pool.query(`SELECT fcm_token FROM users WHERE id = $1`, [userId]);
    return result.rows[0]?.fcm_token || null;
  }
};
module.exports = userRepository;
