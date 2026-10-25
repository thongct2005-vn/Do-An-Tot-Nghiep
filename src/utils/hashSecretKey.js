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

// ---- Mã hóa secret_key khi lưu DB (AES-256-GCM) ----
// Khóa nằm ở biến môi trường SECRET_KEY_ENCRYPTION_KEY (64 ký tự hex = 32 byte).
// Dạng lưu: enc:v1:<iv>:<tag>:<ciphertext> (base64)
const ENC_PREFIX = "enc:v1:";

function getEncryptionKey() {
  const hex = process.env.SECRET_KEY_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      "Chuỗi mã bí mật phải là chuỗi hex dài 64 ký tự (32 byte)",
    );
  }
  return Buffer.from(hex, "hex");
}

function encryptSecretKey(plainText) {
  if (!plainText) return plainText;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    ENC_PREFIX +
    [iv, tag, encrypted].map((b) => b.toString("base64")).join(":")
  );
}

function decryptSecretKey(stored) {
  if (!stored) return stored;

  const parts = String(stored).startsWith(ENC_PREFIX)
    ? String(stored).slice(ENC_PREFIX.length).split(":")
    : [];
  if (parts.length !== 3) {
    throw new Error("Mã bí mật không đúng định dạng mã hóa");
  }

  const [iv, tag, encrypted] = parts.map((part) =>
    Buffer.from(part, "base64"),
  );
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

module.exports = {
  computeSignature,
  isSameSignature,
  encryptSecretKey,
  decryptSecretKey,
};