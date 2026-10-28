const webhookRepository = require("../../../../modules/webhook/webhook.repository");
const pool = require("../../../../config/database");

const merchantPaymentRequestRepository = {
  async insertMerchantPaymentRequest({
    id,
    referenceCode,
    destinationUserId,
    amount,
    description,
    orderId,
    items = [],
    callbackUrl = null,
    returnUrl = null,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO payment_requests
           (id, reference_code, destination_user_id, amount, description, order_id, callback_url, return_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, reference_code, amount, description, status, expires_at, created_at, order_id, return_url`,
        [
          id,
          referenceCode,
          destinationUserId,
          amount,
          description,
          orderId,
          callbackUrl,
          returnUrl,
        ],
      );
      const payment = result?.rows[0] ?? null;

      let insertedItems = [];
      if (payment && items.length) {
        const itemResult = await client.query(
          `INSERT INTO payment_request_items
             (id, payment_request_id, product_id, name, quantity, unit_price, description)
           SELECT t.id, $1::uuid, t.product_id, t.name, t.quantity, t.unit_price, t.description
           FROM unnest($2::uuid[], $3::text[], $4::text[], $5::int[], $6::bigint[], $7::text[])
             AS t(id, product_id, name, quantity, unit_price, description)
           RETURNING product_id, name, quantity, unit_price, description`,
          [
            payment.id,
            items.map((i) => i.id),
            items.map((i) => i.productId),
            items.map((i) => i.name),
            items.map((i) => i.quantity),
            items.map((i) => i.unitPrice),
            items.map((i) => i.description),
          ],
        );
        insertedItems = itemResult.rows.map((row) => ({
          ...row,
          unit_price: Number(row.unit_price),
        }));
      }

      await client.query("COMMIT");
      return payment ? { ...payment, items: insertedItems } : null;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async findPaymentByOrderId({ orderId, merchantId }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await webhookRepository.expireDuePayments(client, { orderId, merchantId });
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