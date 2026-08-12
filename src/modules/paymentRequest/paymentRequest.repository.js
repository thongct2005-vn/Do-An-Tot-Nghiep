const pool = require("../../config/database");

const paymentRequestRepository = {
  async getStaticQRTokenByUserId(userId) {
    const result = await pool.query(
      `SELECT static_qr_token FROM users WHERE id = $1`,
      [userId],
    );
    return result.rows[0]?.static_qr_token ?? null;
  },

  async setStaticQRTokenForUser({ userId, newToken }) {
    const result = await pool.query(
      `UPDATE users SET static_qr_token = $1 WHERE id = $2
            
            RETURNING static_qr_token`,
      [newToken, userId],
    );
    return result.rows[0]?.static_qr_token ?? null;
  },

  async getUserAndWalletByStaticQRToken(token) {
    const result = await pool.query(
      `
        SELECT u.id AS user_id, u.role, u.full_name, u.phone, u.status AS user_status,
        w.id AS wallet_id, w.status AS wallet_status
        FROM users u
        JOIN wallets w ON w.user_id = u.id
        WHERE u.static_qr_token = $1
        `,
      [token],
    );

    return result?.rows[0] ?? null;
  },

  async insertPaymentRequest({
    id,
    referenceCode,
    destinationUserId,
    destinationWalletId,
    amount,
    description,
  }) {
    const result = await pool.query(
      `INSERT INTO payment_requests
         (id, reference_code, destination_user_id, destination_wallet_id, amount, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, reference_code, amount, description, status, expires_at, created_at`,
      [
        id,
        referenceCode,
        destinationUserId,
        destinationWalletId,
        amount,
        description,
      ],
    );
    return result?.rows[0] ?? null;
  },

  async findByReferenceCode(referenceCode) {
    const result = await pool.query(
      `SELECT pr.*, (pr.expires_at <= NOW()) AS is_expires, u.full_name AS destination_name, u.phone AS destination_phone, u.role
       FROM payment_requests pr
       JOIN users u ON u.id = pr.destination_user_id
       WHERE pr.reference_code = $1`,
      [referenceCode],
    );
    return result?.rows[0] ?? null;
  },

  async findByReferenceCodeForUpdate(client, referenceCode) {
    const result = await client.query(
      `SELECT *, (expires_at <= NOW()) AS is_expires FROM payment_requests WHERE reference_code = $1 FOR UPDATE`,
      [referenceCode],
    );
    return result?.rows[0] ?? null;
  },

  async markAsPaid(client, { referenceCode, sourceUserId, transactionId }) {
    const result = await client.query(
      `UPDATE payment_requests
       SET status = 'PAID', source_user_id = $1, transaction_id = $2, paid_at = now(), updated_at = now()
       WHERE reference_code = $3
       RETURNING *`,
      [sourceUserId, transactionId, referenceCode],
    );
    return result?.rows[0] ?? null;
  },
};

module.exports = paymentRequestRepository;
