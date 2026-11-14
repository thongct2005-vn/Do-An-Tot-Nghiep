const { computeSignature } = require("./hashSecretKey");

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
  const data = [paymentId, String(amount), status, paidAtIso, orderId].join(
    "|",
  );
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
