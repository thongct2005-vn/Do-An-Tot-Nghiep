const axios = require("axios");
const { computeSignature } = require("./hashSecretKey");

async function postCallBack({
  callbackUrl,
  secretKey,
  time,
  paymentId,
  orderId,
  amount,
  status,
  paidAt,
}) {
  try {
    const payloadData = {
      payment_id: paymentId,
      order_id: orderId,
      amount: amount,
      status: status,
      paid_at: paidAt,
    };
    const rawBody = JSON.stringify(payloadData);
    const signature = computeSignature(secretKey, time, rawBody);
    const response = await axios.post(callbackUrl, payloadData, {
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": time,
        "X-Signature": signature,
      },
    });

    return response.data;
  } catch (error) {
    if (!error.statusCode) error.statusCode = 500;
    throw error;
  }
}

module.exports = { postCallBack, computeSignature };
