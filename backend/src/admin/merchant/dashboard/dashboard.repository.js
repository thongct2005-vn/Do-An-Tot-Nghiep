const pool = require("../../../config/database");

const dashboardRepository = {
  async getMerchantInfoById(userId) {
    const result = await pool.query(
      `
            SELECT u.full_name, u.call_back_url, u.api_key, u.balance, u.secret_key
            FROM users u
            WHERE id = $1
            `,
      [userId],
    );
    return result.rows[0];
  },

  async getMerchantInfoByApiKey(apiKey) {
    const result = await pool.query(
      `
            SELECT u.id, u.full_name, u.call_back_url, u.api_key, u.balance, u.secret_key
            FROM users u
            WHERE api_key = $1
            `,
      [apiKey],
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
