const crypto = require("crypto");

// TOTP theo RFC 6238 (HMAC-SHA1, 6 số, 30 giây) - tương thích Google Authenticator
const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // chấp nhận lệch ±1 bước (±30 giây) do đồng hồ điện thoại
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of String(text).replace(/=+$/, "").toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Khoá TOTP không hợp lệ");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secretBuffer, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuffer).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

const totpUtil = {
  STEP_SECONDS,

  // 20 byte ngẫu nhiên (160 bit) mã hoá base32
  generateSecret() {
    return base32Encode(crypto.randomBytes(20));
  },

  currentStep(nowMs = Date.now()) {
    return Math.floor(nowMs / 1000 / STEP_SECONDS);
  },

  /**
   * Trả về số bước (step) khớp với mã, hoặc null nếu sai.
   * Chỉ chấp nhận step lớn hơn lastStep để một mã không dùng được hai lần.
   */
  verifyCode(secretBase32, code, { lastStep = null, nowMs = Date.now() } = {}) {
    const input = Buffer.from(String(code));
    const secret = base32Decode(secretBase32);
    const now = totpUtil.currentStep(nowMs);
    let matched = null;
    // Duyệt hết cửa sổ và so sánh hằng thời gian để không lộ thông tin qua thời gian xử lý
    for (let i = -WINDOW; i <= WINDOW; i++) {
      const step = now + i;
      const expected = Buffer.from(hotp(secret, step));
      const same =
        expected.length === input.length &&
        crypto.timingSafeEqual(expected, input);
      if (same && matched === null && (lastStep === null || step > lastStep)) {
        matched = step;
      }
    }
    return matched;
  },

  buildOtpAuthUri({ secret, account, issuer }) {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    return (
      `otpauth://totp/${label}?secret=${secret}` +
      `&issuer=${encodeURIComponent(issuer)}` +
      `&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
    );
  },

  // Khoá bí mật được mã hoá AES-256-GCM trước khi lưu DB (TOTP_ENC_KEY: 64 ký tự hex)
  encryptSecret(plain) {
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((b) => b.toString("base64")).join(":");
  },

  decryptSecret(payload) {
    const key = getKey();
    const [iv, tag, encrypted] = String(payload)
      .split(":")
      .map((part) => Buffer.from(part, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  },
};

function getKey() {
  const hex = process.env.TOTP_ENC_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Thiếu hoặc sai biến môi trường TOTP_ENC_KEY (cần 64 ký tự hex)");
  }
  return Buffer.from(hex, "hex");
}

module.exports = totpUtil;