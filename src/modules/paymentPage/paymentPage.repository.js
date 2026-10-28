const pool = require("../../config/database");
const webhookRepository = require("../webhook/webhook.repository");

const SELECT_SQL = `
  SELECT pr.id, pr.reference_code, pr.order_id, pr.destination_user_id,
         pr.amount, pr.description, pr.status, pr.paid_at, pr.return_url,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM (pr.expires_at - NOW()))))::int AS seconds_left,
         u.full_name AS merchant_name, u.secret_key AS merchant_secret_key
  FROM payment_requests pr
  JOIN users u ON u.id = pr.destination_user_id
  WHERE pr.reference_code = $1
    AND pr.order_id IS NOT NULL`;

const paymentPageRepository = {
  /**
   * Lấy thông tin đơn để hiển thị trên trang thanh toán (không cần đăng nhập).
   * Chỉ lấy đơn do merchant tạo (có order_id). Nếu đơn đã quá hạn mà vẫn PENDING thì
   * chuyển sang FAILED (và xếp webhook "failed") rồi đọc lại, giống lúc merchant tra cứu.
   */
  async findByReferenceCode(referenceCode) {
    let { rows } = await pool.query(SELECT_SQL, [referenceCode]);
    let row = rows[0] ?? null;
    if (!row) return null;

    if (row.status === "PENDING" && row.seconds_left === 0) {
      await webhookRepository.expireDuePayments(pool, {
        orderId: row.order_id,
        merchantId: row.destination_user_id,
      });
      ({ rows } = await pool.query(SELECT_SQL, [referenceCode]));
      row = rows[0] ?? null;
    }
    return row;
  },
};

module.exports = paymentPageRepository;