const pool = require("../../config/database");

const userRepository = {
  async findUserByPhone(phone) {
    const result = await pool.query(
      `SELECT id, phone, full_name FROM users WHERE phone = $1`,
      [phone],
    );
    return result.rows[0];
  },

  async findUserByPhoneList(phones) {
    const result = await pool.query(
      `SELECT id, phone, full_name FROM users WHERE phone = ANY($1)`,
      [phones],
    );
    return result.rows;
  },

  async checkPinStatus(userId){
    const result = await pool.query(`SELECT pin_hash FROM users WHERE id = $1 `, [userId]);
    return result.rows[0];
  },

  async createPin(userId, pinHash){
    await pool.query(`UPDATE users SET pin_hash = $1 WHERE id = $2`,[pinHash, userId]);
  }
};
module.exports = userRepository;
