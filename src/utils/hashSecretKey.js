const crypto = require("crypto");
function computeSignature(secretKey, timestamp, rawBody) {
  return crypto
    .createHmac("sha256", secretKey)
    .update(timestamp + "." + rawBody)
    .digest("hex");
}

function isSameSignature(received, expected) {
  const a = Buffer.from(String(received), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { computeSignature, isSameSignature };
