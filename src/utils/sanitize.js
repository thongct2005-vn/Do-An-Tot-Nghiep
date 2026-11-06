// Tiện ích lọc ký tự đặc biệt cho dữ liệu người dùng gửi lên.

// Ký tự điều khiển (không in được), gồm cả null byte.
// Giữ lại \t (0009), \n (000A), \r (000D) vì là ký tự bình thường trong văn bản.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Ký tự vô hình / đảo chiều hiển thị (zero-width, bidi override).
// Hay dùng để giả mạo nội dung (vd: tên trông giống nhau nhưng khác byte).
// \u200B-\u200F: zero-width + dấu hướng chữ
// \u202A-\u202E: bidi embedding/override
// \u2066-\u2069: bidi isolate
// \uFEFF: BOM / zero-width no-break space
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

// Chuyển giá trị về chuỗi an toàn.
// Chỉ nhận chuỗi hoặc số hữu hạn; object/array (vd: ?keyword[a]=1),
// boolean, NaN, Infinity coi như không hợp lệ → trả null.
function toStr(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

// Xóa ký tự điều khiển khỏi chuỗi. Không phải chuỗi thì trả nguyên.
function stripControlChars(value) {
  return typeof value === "string" ? value.replace(CONTROL_CHARS, "") : value;
}

/**
 * Lọc văn bản tự do (mô tả, ghi chú...).
 * Bỏ ký tự điều khiển, ký tự vô hình, thẻ HTML (< >), gom khoảng trắng, cắt độ dài.
 * null/undefined giữ nguyên, kiểu không hợp lệ trả về undefined.
 *
 * Tùy chọn:
 *  - maxLength: số ký tự tối đa (mặc định 255)
 *  - multiline: true = cho phép nhiều dòng (ghi chú dài), false = ép về 1 dòng
 */
function sanitizeText(value, { maxLength = 255, multiline = false } = {}) {
  // null/undefined giữ nguyên để nơi gọi tự quyết định (bỏ qua hoặc báo thiếu)
  if (value === undefined || value === null) return value;

  // Kiểu không hợp lệ (object, array...) → undefined
  const str = toStr(value);
  if (str === null) return undefined;

  let out = str
    // Chuẩn hóa Unicode về dạng NFC: chữ có dấu luôn là 1 ký tự thống nhất
    // (quan trọng với tiếng Việt để so sánh, tìm kiếm không bị lệch)
    .normalize("NFC")
    // Ký tự điều khiển: nhiều dòng thì xóa, 1 dòng thì đổi thành khoảng trắng
    .replace(CONTROL_CHARS, multiline ? "" : " ")
    // Xóa ký tự vô hình
    .replace(INVISIBLE_CHARS, "")
    // Xóa < và > để chặn thẻ HTML (lớp phòng thủ phụ chống XSS)
    .replace(/[<>]/g, "");

  out = multiline
    ? // Nhiều dòng: gom dấu cách/tab liền nhau thành 1, tối đa 1 dòng trống liên tiếp
      out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
    : // 1 dòng: mọi khoảng trắng và xuống dòng liền nhau → 1 dấu cách
      out.replace(/\s+/g, " ");

  // Cắt khoảng trắng đầu/cuối rồi giới hạn độ dài
  return out.trim().slice(0, maxLength);
}

/**
 * Escape ký tự đại diện của LIKE/ILIKE (\ % _)
 * để người dùng không gõ "%" lấy toàn bộ dữ liệu.
 * Ví dụ: "50%" → "50\%"
 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Lọc từ khóa tìm kiếm.
 * Bỏ ký tự thường dùng để tiêm lệnh (' " ` ; < >), chuỗi comment SQL
 * (dấu gạch đôi và dấu chú thích khối), rồi escape ký tự đại diện LIKE.
 * Kết quả dùng trực tiếp trong ILIKE '%' || $n || '%'.
 * (Phòng thủ chính chống SQL injection vẫn là truy vấn tham số hóa $n)
 */
function sanitizeSearch(value, { maxLength = 100 } = {}) {
  // Lọc cơ bản trước (bỏ ký tự lạ, gom khoảng trắng, cắt độ dài 100)
  const text = sanitizeText(value, { maxLength });
  // null/undefined/kiểu sai thì trả nguyên kết quả
  if (text === undefined || text === null) return text;

  const cleaned = text
    .replace(/['"`;]/g, "") // bỏ nháy đơn, nháy kép, backtick, dấu chấm phẩy
    .replace(/\/\*|\*\//g, "") // bỏ mở/đóng comment khối
    .replace(/-{2,}/g, "-") // "--" (comment SQL) → "-"
    .trim();

  // Bước cuối: escape %, _, \ (không gọi escapeLike thêm lần nữa kẻo bị escape đôi)
  return escapeLike(cleaned);
}

/** Số điện thoại: chỉ giữ chữ số (cho phép nhập "0912 345 678", "0912.345.678") */
function sanitizePhone(value) {
  if (value === undefined || value === null) return value;
  const str = toStr(value);
  if (str === null) return undefined;
  // \D = mọi ký tự không phải chữ số; tối đa 15 chữ số (chuẩn E.164)
  return str.replace(/\D/g, "").slice(0, 15);
}

/** Email: bỏ khoảng trắng, ký tự điều khiển và ký tự không thể có trong email */
function sanitizeEmail(value) {
  if (value === undefined || value === null) return value;
  const str = toStr(value);
  if (str === null) return undefined;
  return str
    .replace(CONTROL_CHARS, "") // bỏ ký tự điều khiển
    .replace(INVISIBLE_CHARS, "") // bỏ ký tự vô hình
    .replace(/[\s<>"'`;,()\\]/g, "") // bỏ khoảng trắng và ký tự không hợp lệ trong email
    .slice(0, 254); // email tối đa 254 ký tự
}

module.exports = {
  stripControlChars,
  sanitizeText,
  sanitizeSearch,
  sanitizePhone,
  sanitizeEmail,
  escapeLike,
};