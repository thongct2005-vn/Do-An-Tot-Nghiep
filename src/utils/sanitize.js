// Tiện ích lọc ký tự đặc biệt cho dữ liệu người dùng gửi lên.
// Ký tự điều khiển (giữ lại \t \n \r), gồm cả null byte
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// Ký tự vô hình / đảo chiều hiển thị (zero-width, bidi override) hay dùng để giả mạo nội dung
const INVISIBLE_CHARS = /[​-‏‪-‮⁦-⁩﻿]/g;

// Chỉ nhận chuỗi hoặc số; object/array (vd: ?keyword[a]=1) coi như không hợp lệ
function toStr(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function stripControlChars(value) {
  return typeof value === "string" ? value.replace(CONTROL_CHARS, "") : value;
}

/**
 * Lọc văn bản tự do (mô tả, ghi chú...).
 * Bỏ ký tự điều khiển, ký tự vô hình, thẻ HTML (< >), gom khoảng trắng, cắt độ dài.
 * null/undefined giữ nguyên, kiểu không hợp lệ trả về undefined.
 */
function sanitizeText(value, { maxLength = 255, multiline = false } = {}) {
  if (value === undefined || value === null) return value;
  const str = toStr(value);
  if (str === null) return undefined;

  let out = str
    .normalize("NFC")
    .replace(CONTROL_CHARS, multiline ? "" : " ")
    .replace(INVISIBLE_CHARS, "")
    .replace(/[<>]/g, "");

  out = multiline
    ? out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
    : out.replace(/\s+/g, " ");

  return out.trim().slice(0, maxLength);
}

/** Escape ký tự đại diện của LIKE/ILIKE (\ % _) để người dùng không gõ "%" lấy toàn bộ dữ liệu */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Lọc từ khóa tìm kiếm.
 * Bỏ ký tự thường dùng để tiêm lệnh (' " ` ; < >), chuỗi comment SQL (dấu gạch đôi và dấu chú thích khối),
 * rồi escape ký tự đại diện LIKE. Kết quả dùng trực tiếp trong ILIKE '%' || $n || '%'.
 */
function sanitizeSearch(value, { maxLength = 100 } = {}) {
  const text = sanitizeText(value, { maxLength });
  if (text === undefined || text === null) return text;

  const cleaned = text
    .replace(/['"`;]/g, "")
    .replace(/\/\*|\*\//g, "")
    .replace(/-{2,}/g, "-")
    .trim();

  return escapeLike(cleaned);
}

/** Số điện thoại: chỉ giữ chữ số (cho phép nhập "0912 345 678", "0912.345.678") */
function sanitizePhone(value) {
  if (value === undefined || value === null) return value;
  const str = toStr(value);
  if (str === null) return undefined;
  return str.replace(/\D/g, "").slice(0, 15);
}

/** Email: bỏ khoảng trắng, ký tự điều khiển và ký tự không thể có trong email */
function sanitizeEmail(value) {
  if (value === undefined || value === null) return value;
  const str = toStr(value);
  if (str === null) return undefined;
  return str
    .replace(CONTROL_CHARS, "")
    .replace(INVISIBLE_CHARS, "")
    .replace(/[\s<>"'`;,()\\]/g, "")
    .slice(0, 254);
}

module.exports = {
  stripControlChars,
  sanitizeText,
  sanitizeSearch,
  sanitizePhone,
  sanitizeEmail,
  escapeLike,
};