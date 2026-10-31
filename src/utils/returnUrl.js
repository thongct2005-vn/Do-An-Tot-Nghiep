const { computeSignature } = require("./hashSecretKey");

/**
 * Dựng URL đưa khách quay về cửa hàng, có chữ ký để merchant kiểm tra.
 *
 * Tham số thêm vào return_url của merchant:
 *   order_id, payment_id, amount, status, paid_at (bỏ qua nếu chưa thanh toán),
 *   timestamp (giây, UTC), signature
 *
 * Chữ ký (cùng kiểu với webhook):
 *   signature = HMAC_SHA256_hex(secret_key, `${timestamp}.${data}`)
 *   data      = `${payment_id}|${amount}|${status}|${paid_at}|${order_id}`
 *   (paid_at = "" nếu không có; order_id đặt cuối để chuỗi không bị nhập nhằng)
 *
 * Trả về null nếu return_url không hợp lệ.
 */
function buildSignedReturnUrl({
  returnUrl,
  secretKey,
  paymentId,
  orderId,
  amount,
  status,
  paidAt,
  time = Math.floor(Date.now() / 1000),
}) {
  let u;
  try {
    u = new URL(returnUrl);
  } catch (_) {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;

  const paidAtIso = paidAt ? new Date(paidAt).toISOString() : "";
  const timestamp = String(time);
  const data = [paymentId, String(amount), status, paidAtIso, orderId].join("|");
  const signature = computeSignature(secretKey, timestamp, data);

  u.searchParams.set("order_id", orderId);
  u.searchParams.set("payment_id", paymentId);
  u.searchParams.set("amount", String(amount));
  u.searchParams.set("status", status);
  if (paidAtIso) u.searchParams.set("paid_at", paidAtIso);
  else u.searchParams.delete("paid_at");
  u.searchParams.set("timestamp", timestamp);
  u.searchParams.set("signature", signature);
  return u.toString();
}

module.exports = { buildSignedReturnUrl };