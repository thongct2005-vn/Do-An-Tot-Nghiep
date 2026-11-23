// credentials.repository.js: Truy vấn khóa tích hợp API Merchant và lịch sử thay đổi từ cơ sở dữ liệu.
const pool = require("../../config/database");

const adminCredentialsRepository = {
  async getMerchantCredentialsRow(merchantId, db = pool) {
    const { rows } = await db.query(
      "SELECT id, api_key, secret_key, credentials_revoked, credentials_revision FROM users WHERE id = $1 AND role = 'MERCHANT'",
      [merchantId],
    );
    return rows[0] || null;
  },

  async merchantExists(merchantId, db = pool) {
    const res = await db.query(
      "SELECT 1 FROM users WHERE id = $1 AND role = 'MERCHANT'",
      [merchantId],
    );
    return res.rowCount > 0;
  },

  async getCredentialsHistory(
    { merchantId, actions, action = null, limit, offset },
    db = pool,
  ) {
    const params = [merchantId, actions, action];
    const where =
      "h.user_id = $1 AND h.action = ANY($2::text[]) AND ($3::text IS NULL OR h.action = $3)";

    const [countRes, rowsRes] = await Promise.all([
      db.query(
        `SELECT count(*) FROM admin_user_change_history h WHERE ${where}`,
        params,
      ),
      db.query(
        `SELECT h.id, h.action, h.reason, h.created_at, h.admin_id, u.full_name AS admin_name,
                jsonb_build_object('state', h.old_values->>'state', 'revision', h.old_values->>'revision', 'api_key_masked', h.old_values->>'api_key_masked') AS old_values,
                jsonb_build_object('state', h.new_values->>'state', 'revision', h.new_values->>'revision', 'api_key_masked', h.new_values->>'api_key_masked', 'cancelled_payments', h.new_values->'cancelled_payments') AS new_values
           FROM admin_user_change_history h
           LEFT JOIN users u ON u.id = h.admin_id
          WHERE ${where}
          ORDER BY h.created_at DESC, h.id DESC
          LIMIT $4 OFFSET $5`,
        [...params, limit, offset],
      ),
    ]);

    return {
      total: Number(countRes.rows[0]?.count || 0),
      items: rowsRes.rows,
    };
  },
};

module.exports = adminCredentialsRepository;

