const { httpError } = require('../../utils/httpError');
const { assertPositiveIntegerAmount } = require('./feeCalculator');

// Called only with the Payment Request already locked by processQRPayment.
function readMerchantPaymentFeeSnapshot(payment, merchantId, amount) {
  const feeRaw = payment.merchant_fee_amount_snapshot;
  const snapshot = payment.merchant_fee_rule_snapshot;
  if (feeRaw === null || feeRaw === undefined || !snapshot) {
    throw httpError(409, 'Mã QR cũ chưa chốt phí Merchant. Vui lòng tạo mã QR mới.');
  }
  const fee = Number(feeRaw);
  const validAmount = assertPositiveIntegerAmount(amount);
  if (!Number.isSafeInteger(fee) || fee < 0 || fee > validAmount
      || snapshot.pricing_model !== 'MERCHANT_INVOICE_BOUNDARY_V1'
      || snapshot.amount !== validAmount || snapshot.fee_amount !== fee
      || snapshot.merchant_user_id !== merchantId
      || String(payment.destination_user_id) !== String(merchantId)
      || Number(payment.amount) !== validAmount
      || typeof snapshot.captured_at !== 'string' || !Number.isFinite(Date.parse(snapshot.captured_at))) {
    throw httpError(409, 'Bản chụp phí QR không hợp lệ. Vui lòng tạo mã QR mới.');
  }
  return { amount: validAmount, fee_amount: fee, net_amount: validAmount - fee, fee_rate_snapshot: snapshot };
}

module.exports = { readMerchantPaymentFeeSnapshot };
