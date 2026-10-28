const pool = require("../../config/database");

// Thời gian chờ trước lần thử tiếp theo (giây), theo số lần đã thử.
// 8 lần tổng cộng: ngay lập tức, 1p, 5p, 30p, 2h, 6h, 12h, 24h.
const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600, 43200, 86400];
// Thời gian "thuê" dòng khi worker đang gửi; nếu worker chết thì hết hạn và được gửi lại.
const LEASE_SECONDS = 120;

const EVENT_STATUS = {
  "payment.success": "success",
  "payment.failed": "failed",
};

const webhookRepository = {
  /**
   * Đưa webhook vào hàng đợi. Gọi TRONG cùng transaction với việc đổi trạng thái đơn
   * để "đã thanh toán" và "sẽ gửi callback" luôn đi cùng nhau.
   * Chỉ tạo khi bên nhận là MERCHANT. Gọi lại nhiều lần không tạo trùng.
   */
  async enqueue(client, { paymentRequestId, eventType }) {
    const status = EVENT_STATUS[eventType];
    if (!status) throw new Error(`Sự kiện webhook không hợp lệ: ${eventType}`);
    const result = await client.query(
      `INSERT INTO webhook_deliveries (payment_request_id, merchant_id, event_type, payload)
       SELECT pr.id, pr.destination_user_id, $2::varchar,
              jsonb_build_object(
                'payment_id', pr.id,
                'order_id',   pr.order_id,
                'amount',     pr.amount,
                'status',     $3::text,
                'paid_at',    CASE WHEN pr.paid_at IS NULL THEN NULL
                                   ELSE to_char(pr.paid_at AT TIME ZONE 'UTC',
                                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
              )
       FROM payment_requests pr
       JOIN users u ON u.id = pr.destination_user_id
       WHERE pr.id = $1 AND u.role = 'MERCHANT'
       ON CONFLICT (payment_request_id, event_type) DO NOTHING
       RETURNING id`,
      [paymentRequestId, eventType, status],
    );
    return result.rows[0]?.id ?? null;
  },

  /**
   * Chuyển các đơn merchant đã quá hạn từ PENDING sang FAILED và xếp webhook "failed".
   * Một câu lệnh duy nhất nên không thể xảy ra chuyện "đã FAILED mà không có webhook".
   * Có thể giới hạn theo một đơn (khi merchant tra cứu trạng thái).
   * Nếu khách đang thanh toán đúng lúc hết hạn: tiến trình thanh toán giữ khoá dòng,
   * câu UPDATE này chờ rồi thấy status đã là PAID nên bỏ qua.
   */
  async expireDuePayments(db, { orderId = null, merchantId = null, limit = 500 } = {}) {
    const result = await db.query(
      `WITH due AS (
         SELECT id FROM payment_requests
         WHERE status = 'PENDING'
           AND order_id IS NOT NULL
           AND expires_at <= NOW()
           AND ($1::text IS NULL OR order_id = $1)
           AND ($2::uuid IS NULL OR destination_user_id = $2)
         ORDER BY expires_at
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       ),
       expired AS (
         UPDATE payment_requests pr
         SET status = 'FAILED', updated_at = NOW()
         FROM due
         WHERE pr.id = due.id AND pr.status = 'PENDING'
         RETURNING pr.id, pr.destination_user_id, pr.order_id, pr.amount
       ),
       queued AS (
         INSERT INTO webhook_deliveries (payment_request_id, merchant_id, event_type, payload)
         SELECT e.id, e.destination_user_id, 'payment.failed',
                jsonb_build_object(
                  'payment_id', e.id,
                  'order_id',   e.order_id,
                  'amount',     e.amount,
                  'status',     'failed',
                  'paid_at',    NULL
                )
         FROM expired e
         JOIN users u ON u.id = e.destination_user_id
         WHERE u.role = 'MERCHANT'
         ON CONFLICT (payment_request_id, event_type) DO NOTHING
         RETURNING id
       )
       SELECT (SELECT count(*) FROM expired)::int AS expired_count`,
      [orderId, merchantId, limit],
    );
    return result.rows[0].expired_count;
  },

  /**
   * Lấy tối đa `limit` webhook đến hạn gửi và "thuê" chúng LEASE_SECONDS.
   * SKIP LOCKED giúp chạy nhiều instance mà không gửi trùng.
   * URL: callback_url của đơn nếu có, không thì callback mặc định của merchant.
   */
  async claimDue(limit = 10) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `WITH picked AS (
           SELECT id FROM webhook_deliveries
           WHERE status = 'PENDING' AND next_retry_at <= NOW()
           ORDER BY next_retry_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE webhook_deliveries d
         SET next_retry_at = NOW() + ($2::int * INTERVAL '1 second')
         FROM picked
         WHERE d.id = picked.id
         RETURNING d.id, d.payment_request_id, d.merchant_id, d.event_type, d.payload,
                   d.attempt_count, d.max_attempts,
                   (SELECT COALESCE(pr.callback_url, u.call_back_url)
                      FROM payment_requests pr, users u
                     WHERE pr.id = d.payment_request_id AND u.id = d.merchant_id) AS callback_url,
                   (SELECT u.secret_key FROM users u WHERE u.id = d.merchant_id) AS secret_key`,
        [limit, LEASE_SECONDS],
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

  async markDelivered(id, httpStatus) {
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = 'SUCCESS', attempt_count = attempt_count + 1,
           last_http_status = $2, last_error = NULL, delivered_at = NOW()
       WHERE id = $1`,
      [id, httpStatus],
    );
  },

  /** Ghi nhận một lần gửi lỗi; hết lượt thì chuyển FAILED, ngược lại hẹn lần sau. */
  async markAttemptFailed(id, { attemptCount, maxAttempts, httpStatus, error }) {
    const attemptsDone = attemptCount + 1;
    const exhausted = attemptsDone >= maxAttempts;
    const delay =
      RETRY_DELAYS_SECONDS[Math.min(attemptsDone - 1, RETRY_DELAYS_SECONDS.length - 1)];
    await pool.query(
      `UPDATE webhook_deliveries
       SET attempt_count = $2,
           status = $3,
           next_retry_at = NOW() + ($4::int * INTERVAL '1 second'),
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