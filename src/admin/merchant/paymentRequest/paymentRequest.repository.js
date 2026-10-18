const pool = require("../../../config/database");

const merchantPaymentRequestRepository = {
  async insertMerchantPaymentRequest({
    id,
    referenceCode,
    destinationUserId,
    amount,
    description,
    orderId
  }) {
    const result = await pool.query(
      `INSERT INTO payment_requests
         (id, reference_code, destination_user_id, amount, description, order_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, reference_code, amount, description, status, expires_at, created_at, order_id`,
      [id, referenceCode, destinationUserId, amount, description, orderId],
    );
    return result?.rows[0] ?? null;
  },
};

module.exports = merchantPaymentRequestRepository;
