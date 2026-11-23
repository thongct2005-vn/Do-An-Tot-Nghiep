// paymentPage.helpers.js: Câu SQL truy vấn và hàm ký return_url cho trang thanh toán công khai.
const { decryptSecretKey } = require("../../utils/security/keys");
const { buildSignedReturnUrl } = require("../../utils/security/url");

const PAYMENT_PAGE_REFERENCE_PATTERN = /^[A-Za-z0-9]{8,64}$/;

const PAYMENT_PAGE_SELECT_SQL = `
  SELECT pr.id, pr.reference_code, pr.order_id, pr.destination_user_id,
         pr.amount, pr.description, pr.status, pr.paid_at, pr.return_url, pr.credentials_revision,
         u.credentials_revision AS merchant_credentials_revision,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM (pr.expires_at - NOW()))))::int AS seconds_left,
         u.full_name AS merchant_name, u.secret_key AS merchant_secret_key
  FROM payment_requests pr
  JOIN users u ON u.id = pr.destination_user_id
  WHERE pr.reference_code = $1
    AND pr.order_id IS NOT NULL`;

function signReturnUrl(row, status) {
  if (
    row.credentials_revision == null ||
    String(row.credentials_revision) !== String(row.merchant_credentials_revision) ||
    status === "cancelled"
  ) {
    return null;
  }
  try {
    return buildSignedReturnUrl({
      returnUrl: row.return_url,
      secretKey: decryptSecretKey(row.merchant_secret_key),
      paymentId: row.id,
      orderId: row.order_id,
      amount: Number(row.amount),
      status,
      paidAt: row.paid_at,
    });
  } catch (e) {
    console.error("[pay] không ký được return_url:", e.message);
    return null;
  }
}

module.exports = {
  PAYMENT_PAGE_REFERENCE_PATTERN,
  PAYMENT_PAGE_SELECT_SQL,
  signReturnUrl,
};

