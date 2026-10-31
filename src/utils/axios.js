const axios = require("axios");
const http = require("http");
const https = require("https");
const { computeSignature } = require("./hashSecretKey");
const { assertSafeCallbackUrl, safeLookup } = require("./urlGuard");

const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 8000;

const httpAgent = new http.Agent({ lookup: safeLookup });
const httpsAgent = new https.Agent({ lookup: safeLookup });

/**
 * Gửi 1 webhook đã ký. KHÔNG tự retry, việc retry do webhook worker quyết định.
 * Ném lỗi nếu không nhận được HTTP 2xx.
 * Chữ ký: HMAC-SHA256(secretKey, `${timestamp}.${rawBody}`) trong header X-Signature.
 */
async function postCallBack({
  callbackUrl,
  secretKey,
  time = Math.floor(Date.now() / 1000),
  payload,
  deliveryId,
  attempt,
}) {
  await assertSafeCallbackUrl(callbackUrl);

  const rawBody = JSON.stringify(payload);
  const timestamp = String(time);
  const signature = computeSignature(secretKey, timestamp, rawBody);

  const response = await axios.post(callbackUrl, rawBody, {
    headers: {
      "Content-Type": "application/json",
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      ...(deliveryId && { "X-Delivery-Id": deliveryId }),
      ...(attempt && { "X-Delivery-Attempt": String(attempt) }),
    },
    timeout: WEBHOOK_TIMEOUT_MS,
    maxRedirects: 0, // không đi theo redirect (chống SSRF)
    maxContentLength: 64 * 1024,
    maxBodyLength: 64 * 1024,
    httpAgent,
    httpsAgent,
    transformRequest: [(d) => d], // giữ nguyên rawBody đã ký
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return { status: response.status };
}

module.exports = { postCallBack, computeSignature };