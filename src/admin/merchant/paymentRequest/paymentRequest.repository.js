const pool = require("../../../config/database");

const merchantPaymentRequestRepository = {
  async insertMerchantPaymentRequest({
    id,
    referenceCode,
    destinationUserId,
    amount,
    description,
    orderId,
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

  async findPaymentByOrderId({orderId, merchantId}) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE payment_requests 
       SET status = 'FAILED'
       WHERE order_id = $1
         AND destination_user_id = $2
         AND status = 'PENDING' 
         AND expires_at <= NOW()`,
        [orderId, merchantId],
      );
      const result = await client.query(
        `SELECT pr.*, (pr.expires_at <= NOW()) AS is_expires, u.full_name AS destination_name, u.phone AS destination_phone, u.role
       FROM payment_requests pr
       JOIN users u ON u.id = pr.destination_user_id
       WHERE pr.order_id = $1
         AND pr.destination_user_id = $2`,
        [orderId, merchantId],
      );

      await client.query("COMMIT");
      return result?.rows[0] ?? null;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
};

module.exports = merchantPaymentRequestRepository;
