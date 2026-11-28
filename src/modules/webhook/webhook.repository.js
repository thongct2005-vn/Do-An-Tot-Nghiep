// webhook.repository.js: Hàng đợi webhook, hết hạn thanh toán quá giờ và cơ chế claim/retry cho worker.
const pool = require("../../config/database");
const { uuidv7 } = require("uuidv7");
const {
  WEBHOOK_RETRY_DELAYS_SECONDS,
  WEBHOOK_LEASE_SECONDS,
  WEBHOOK_EVENT_STATUS,
} = require("./webhook.helpers");

const webhookRepository = {
  /**
   * Đẩy 1 sự kiện webhook (`payment.success` / `payment.failed`) vào hàng đợi `webhook_deliveries`
   * ngay bên trong transaction DB hiện tại.
   * - Chỉ tạo bản ghi khi đơn thanh toán thuộc Merchant (`u.role = 'MERCHANT'`).
   * - Dùng `ON CONFLICT (payment_request_id, event_type) DO NOTHING` để chống đẩy trùng sự kiện.
   */
  async enqueue(client, { paymentRequestId, eventType }) {
    const status = WEBHOOK_EVENT_STATUS[eventType];
    if (!status) throw new Error(`Sự kiện webhook không hợp lệ: ${eventType}`);
    // Tạo payload chuẩn theo spec webhook gửi Merchant rồi chèn idempotent vào hàng đợi
    const result = await client.query(
      `INSERT INTO webhook_deliveries(id, payment_request_id, merchant_id, event_type, payload)
       SELECT $4:: uuid, pr.id, pr.destination_user_id, $2:: varchar,
      jsonb_build_object(
        'payment_id', pr.id,
        'order_id', pr.order_id,
        'amount', pr.amount,
        'status', $3:: text,
        'paid_at', CASE WHEN pr.paid_at IS NULL THEN NULL
                                   ELSE to_char(pr.paid_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
      )
       FROM payment_requests pr
       JOIN users u ON u.id = pr.destination_user_id
       WHERE pr.id = $1 AND u.role = 'MERCHANT'
       ON CONFLICT(payment_request_id, event_type) DO NOTHING
       RETURNING id`,
      [paymentRequestId, eventType, status, uuidv7()],
    );
    return result.rows[0]?.id ?? null;
  },

  /**
   * Chuyển các đơn QR động (`payment_requests`) quá hạn sang `FAILED` và xếp hàng gửi webhook `payment.failed`.
   * - Khóa trước Merchant (`FOR UPDATE OF u SKIP LOCKED` theo thứ tự `u.id`) rồi mới khóa `payment_requests`
   *   để giữ đúng thứ tự khóa tránh deadlock với luồng khách quét QR thanh toán.
   */
  async expireDuePayments(db, { orderId = null, merchantId = null, limit = 500 } = {}) {
    const webhookIds = Array.from({ length: limit }, () => uuidv7());
    const result = await db.query(
      `WITH locked_merchants AS MATERIALIZED (
        SELECT u.id FROM users u
         WHERE u.role = 'MERCHANT' AND ($2::uuid IS NULL OR u.id = $2)
           AND EXISTS (SELECT 1 FROM payment_requests pr
             WHERE pr.destination_user_id=u.id AND pr.status='PENDING'
               AND pr.order_id IS NOT NULL AND pr.expires_at <= NOW()
               AND ($1::text IS NULL OR pr.order_id=$1))
         ORDER BY u.id
         FOR UPDATE OF u SKIP LOCKED
      ), due AS(
        SELECT pr.id FROM payment_requests pr
         JOIN locked_merchants m ON m.id=pr.destination_user_id
         WHERE pr.status = 'PENDING'
           AND pr.order_id IS NOT NULL
           AND pr.expires_at <= NOW()
           AND($1:: text IS NULL OR pr.order_id = $1)
           AND($2:: uuid IS NULL OR pr.destination_user_id = $2)
         ORDER BY pr.expires_at
         LIMIT $3
         FOR UPDATE OF pr SKIP LOCKED
      ),
      expired AS(
        UPDATE payment_requests pr
         SET status = 'FAILED', updated_at = NOW()
         FROM due
         WHERE pr.id = due.id AND pr.status = 'PENDING'
         RETURNING pr.id, pr.destination_user_id, pr.order_id, pr.amount
      ),
      queued AS(
         INSERT INTO webhook_deliveries (id, payment_request_id, merchant_id, event_type, payload)
         SELECT ids.id, e.id, e.destination_user_id, 'payment.failed',
        jsonb_build_object(
          'payment_id', e.id,
          'order_id', e.order_id,
          'amount', e.amount,
          'status', 'failed',
          'paid_at', NULL
        )
         FROM (SELECT x.*, row_number() OVER () AS rn FROM expired x) e
         JOIN unnest($4::uuid[]) WITH ORDINALITY AS ids(id, rn) ON ids.rn = e.rn
         JOIN users u ON u.id = e.destination_user_id
         WHERE u.role = 'MERCHANT'
         ON CONFLICT(payment_request_id, event_type) DO NOTHING
         RETURNING id
      )
       SELECT(SELECT count(*) FROM expired):: int AS expired_count`,
      [orderId, merchantId, limit, webhookIds],
    );
    return result.rows[0]?.expired_count ?? 0;
  },

  /**
   * Bốc tối đa `limit` đơn webhook `PENDING` đã đến lịch gửi (`next_retry_at <= NOW()`).
   * - Dùng `FOR UPDATE SKIP LOCKED` để nhiều lượt quét/worker không bốc trùng cùng 1 đơn.
   * - Đẩy tạm `next_retry_at` lên `WEBHOOK_LEASE_SECONDS` (120s) trước khi COMMIT nhằm giữ chỗ
   *   trong lúc gọi HTTP ra ngoài (nếu worker crash giữa chừng, sau 120s đơn sẽ tự được bốc lại).
   */
  async claimDue(limit = 10) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `WITH picked AS(
        SELECT id FROM webhook_deliveries
           WHERE status = 'PENDING' AND next_retry_at <= NOW()
           ORDER BY next_retry_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
      )
         UPDATE webhook_deliveries d
         SET next_retry_at = NOW() + ($2:: int * INTERVAL '1 second')
         FROM picked
         WHERE d.id = picked.id
         RETURNING d.id, d.payment_request_id, d.merchant_id, d.event_type, d.payload,
      d.attempt_count, d.max_attempts,
      (SELECT COALESCE(pr.callback_url, u.call_back_url)
                      FROM payment_requests pr, users u
                     WHERE pr.id = d.payment_request_id AND u.id = d.merchant_id) AS callback_url,
      (SELECT u.secret_key FROM users u WHERE u.id = d.merchant_id) AS secret_key`,
        [limit, WEBHOOK_LEASE_SECONDS],
      );
      await client.query("COMMIT");
      return result.rows;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * Cập nhật đơn webhook sang `SUCCESS` sau khi endpoint Merchant phản hồi thành công (HTTP 2xx).
   */
  async markDelivered(id, httpStatus) {
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = 'SUCCESS', attempt_count = attempt_count + 1,
      last_http_status = $2, last_error = NULL, delivered_at = NOW()
       WHERE id = $1`,
      [id, httpStatus],
    );
  },

  /**
   * Ghi nhận 1 lần gửi webhook thất bại và lên lịch retry theo `WEBHOOK_RETRY_DELAYS_SECONDS`.
   * - Chưa vượt `maxAttempts`: giữ `PENDING` và hẹn `next_retry_at = NOW() + delay` giây.
   * - Đã đủ `maxAttempts` (`exhausted = true`): chuyển hẳn `status = 'FAILED'`, ngừng gửi lại.
   */
  async markAttemptFailed(id, { attemptCount, maxAttempts, httpStatus, error }) {
    const attemptsDone = attemptCount + 1;
    const exhausted = attemptsDone >= maxAttempts;
    const delay =
      WEBHOOK_RETRY_DELAYS_SECONDS[
        Math.min(attemptsDone - 1, WEBHOOK_RETRY_DELAYS_SECONDS.length - 1)
      ];
    await pool.query(
      `UPDATE webhook_deliveries
       SET attempt_count = $2,
      status = $3,
      next_retry_at = NOW() + ($4:: int * INTERVAL '1 second'),
    last_http_status = $5,
      last_error = $6
       WHERE id = $1`,
      [
        id,
        attemptsDone,
        exhausted ? "FAILED" : "PENDING",
        delay,
        httpStatus ?? null,
        String(error || "").slice(0, 500),
      ],
    );
    return { exhausted, delay };
  },
};

module.exports = webhookRepository;
