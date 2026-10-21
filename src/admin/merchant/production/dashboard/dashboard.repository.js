const pool = require("../../../../config/database");

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
            SELECT u.id, u.full_name, u.call_back_url, u.api_key, u.balance, u.secret_key, u.role
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

  async resetApiKey({ userId, apiKey }) {
    const result = await pool.query(
      `UPDATE users SET api_key = $1
       WHERE id = $2 RETURNING api_key`,
      [apiKey, userId],
    );
    return result;
  },

  async resetSecretKey({ userId, secretKey }) {
    const result = await pool.query(
      `UPDATE users SET secret_key = $1
       WHERE id = $2 RETURNING secret_key`,
      [secretKey, userId],
    );
    return result;
  },
};

module.exports = dashboardRepository;
