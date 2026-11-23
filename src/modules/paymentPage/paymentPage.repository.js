// paymentPage.repository.js: Truy vấn thông tin đơn thanh toán công khai và tự động xử lý đơn quá hạn.
const pool = require("../../config/database");
const webhookRepository = require("../webhook/webhook.repository");
const { PAYMENT_PAGE_SELECT_SQL } = require("./paymentPage.helpers");

const paymentPageRepository = {
  async findByReferenceCode(referenceCode) {
    let { rows } = await pool.query(PAYMENT_PAGE_SELECT_SQL, [referenceCode]);
    let row = rows[0] ?? null;
    if (!row) return null;

    if (row.status === "PENDING" && row.seconds_left === 0) {
      await webhookRepository.expireDuePayments(pool, {
        orderId: row.order_id,
        merchantId: row.destination_user_id,
      });
      ({ rows } = await pool.query(PAYMENT_PAGE_SELECT_SQL, [referenceCode]));
      row = rows[0] ?? null;
    }
    return row;
  },
};

module.exports = paymentPageRepository;
