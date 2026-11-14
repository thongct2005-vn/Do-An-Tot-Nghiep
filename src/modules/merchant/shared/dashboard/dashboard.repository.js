const pool = require("../../../../config/database");
const {
  decryptSecretKey,
} = require("../../../../utils/hashSecretKey");

const dashboardRepository = {
  async getMerchantAccountStatus(userId) {
    const result = await pool.query("SELECT id, role, status FROM users WHERE id=$1", [userId]);
    return result.rows[0] ?? null;
  },

  async getMerchantInfoById(userId) {
    const result = await pool.query(
      `
            SELECT u.full_name, u.call_back_url, u.api_key, u.balance, u.secret_key, u.credentials_revoked, u.credentials_revision
            FROM users u
            WHERE id = $1
            `,
      [userId],
    );
    const row = result.rows[0];
    if (row) {
      if (row.credentials_revoked) { row.api_key = null; row.secret_key = null; }
      else row.secret_key = decryptSecretKey(row.secret_key);
    }
    return row;
  },

  async getMerchantInfoByApiKey(apiKey) {
    const result = await pool.query(
      `
            SELECT u.id, u.full_name, u.call_back_url, u.api_key, u.balance, u.secret_key, u.role, u.status, u.credentials_revoked, u.credentials_revision
            FROM users u
            WHERE api_key = $1
            `,
      [apiKey],
    );
    const row = result.rows[0];
    if (row) row.secret_key = row.credentials_revoked ? null : decryptSecretKey(row.secret_key);
    return row;
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
    const row = (await pool.query('SELECT credentials_revision FROM users WHERE id=$1',[userId])).rows[0];
    return require('../credentials').mutate({merchantId:userId,operation:'reset_api',expectedRevision:row?.credentials_revision,selfService:true,apiKey});
  },
  async resetSecretKey({ userId, secretKey }) {
    const row = (await pool.query('SELECT credentials_revision FROM users WHERE id=$1',[userId])).rows[0];
    return require('../credentials').mutate({merchantId:userId,operation:'reset_secret',expectedRevision:row?.credentials_revision,selfService:true,secretKey});
  },

};

module.exports = dashboardRepository;
