// qrAndRef.js: Tiện ích sinh mã tham chiếu giao dịch và ảnh QR DataURL theo cấu hình chuẩn.
const crypto = require("crypto");
const QRCode = require("qrcode");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generateReferenceCode(length = 12) {
  const bytes = crypto.randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

const DEFAULT_QR_OPTIONS = {
  width: 300,
  margin: 2,
  errorCorrectionLevel: "M",
};

/**
 * Sinh chuỗi data URL PNG từ nội dung mã QR.
 */
async function generateQrDataUrl(text, options = {}) {
  return QRCode.toDataURL(text, { ...DEFAULT_QR_OPTIONS, ...options });
}

module.exports = {
  generateReferenceCode,
  DEFAULT_QR_OPTIONS,
  generateQrDataUrl,
};

