const pool = require("../../../config/database");

const dashboardRepository = {
  async getMerchantInfoById(userId) {
    const result = await pool.query(
      `
            SELECT u.full_name, u.call_back_url, u.api_key, u.balance
            FROM users u
            WHERE id = $1
            `,
      [userId],
    );
    return result.rows[0];
  },
  async updateCallBackUrl({ userId, callbackUrl }) {
    await pool.query(
      `
           UPDATE users SET call_back_url = $1
           WHERE id = $2
            `,
      [callbackUrl, userId],
    );
  },
};

module.exports = dashboardRepository;
