const webhookRepository = require("../../../../modules/webhook/webhook.repository");
const pool = require("../../../../config/database");
const transactionRepository = require("../../../../modules/transaction/transaction.repository");
const { httpError } = require("../../../../utils/httpError");

const DUPLICATE_ORDER_INDEX = "payment_requests_merchant_order_uk";

// order_id đã tồn tại (UNIQUE destination_user_id + order_id): báo rõ lý do thay vì "Dữ liệu đã tồn tại".
async function buildDuplicateOrderError({ merchantId, orderId }) {
  const { rows } = await pool.query(
    `SELECT status, (expires_at <= NOW()) AS is_expired
       FROM payment_requests
      WHERE destination_user_id = $1 AND order_id = $2`,
    [merchantId, orderId],
  );
  const existing = rows[0];
  if (existing && ["SUCCESS", "PAID"].includes(existing.status)) {
    return httpError(409, "Đơn hàng này đã được thanh toán");
  }
  if (existing && existing.status === "PENDING" && !existing.is_expired) {
    return httpError(
      409,
      "Đơn hàng này đang chờ thanh toán, vui lòng dùng lại mã thanh toán đã tạo",
    );
  }
  return httpError(
    409,
    "order_id này đã được dùng cho một thanh toán đã hết hạn, vui lòng tạo order_id mới",
  );
}

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

      if (payment) {
        await transactionRepository.recordAudit(client, {
          eventType: "PAYMENT_CREATED",
          payload: {
            payment_id: payment.id,
            merchant_id: destinationUserId,
            order_id: orderId,
            amount: Number(payment.amount),
            expires_at: payment.expires_at,
            item_count: insertedItems.length,
          },
        });
      }

      await client.query("COMMIT");
      return payment ? { ...payment, items: insertedItems } : null;
    } catch (e) {
      await client.query("ROLLBACK");
      if (e.code === "23505" && e.constraint === DUPLICATE_ORDER_INDEX) {
        throw await buildDuplicateOrderError({
          merchantId: destinationUserId,
          orderId,
        });
      }
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