const crypto = require("crypto");
const ENC_PREFIX = "enc:v1:";

// Tạo chữ ký
function computeSignature(secretKey, timestamp, rawBody) {
  return crypto
    .createHmac("sha256", secretKey)
    .update(timestamp + "." + rawBody)
    .digest("hex");
}

// So sánh 2 chữ ký
function isSameSignature(received, expected) {
  const a = Buffer.from(String(received), "utf8"); //Buffer.from("abc", "utf8"); -> <Buffer 61 62 63>
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}



// Kiểm tra khóa tạo SECRET_KEY_ENCRYPTION_KEYY có hợp lệ hay không
// Dài 64 ký tự chỉ gồm chữ a đến f và số 0 đến 9
function getEncryptionKey() {
  const hex = process.env.SECRET_KEY_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("Chuỗi mã bí mật phải là chuỗi hex dài 64 ký tự");
  }
  return Buffer.from(hex, "hex");
}

/* Mã hóa secret key
 Dạng lưu: enc:v1:<iv>:<tag>:<ciphertext>
  1. Tạo iv ngẫu nhiên
  2. Mã hóa plaintext bằng khóa + iv, được ciphertext
  3. Lấy tag xác thực
  4. Gói iv + tag + ciphertext thành một chuỗi có tiền tố để lưu
*/
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
    ENC_PREFIX + [iv, tag, encrypted].map((b) => b.toString("base64")).join(":")
  );
}

/* Giải mã secret key
  1. Kiểm tra tiền tố, bỏ tiền tố rồi tách theo ":" thành 3 phần
  2. Đổi iv, tag, ciphertext từ base64 về Buffer
  3. Tạo decipher bằng khóa + iv, đưa tag vào để xác thực
  4. Giải mã ciphertext (final() kiểm tra tag), ghép lại thành plaintext
*/
function decryptSecretKey(stored) {
  if (!stored) return stored;

  const parts = String(stored).startsWith(ENC_PREFIX)
    ? String(stored).slice(ENC_PREFIX.length).split(":")
    : [];
  if (parts.length !== 3) {
    throw new Error("Mã bí mật không đúng định dạng mã hóa");
  }

  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64"));
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
