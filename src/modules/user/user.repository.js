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
};
module.exports = userRepository;
