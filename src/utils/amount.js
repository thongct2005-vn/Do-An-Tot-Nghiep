const { httpError } = require("./httpError");

// Kiểm tra số tiền có hợp lệ hay không
function parseAmount(raw, message = "Số tiền không hợp lệ") {
  let value;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    value = Number(raw.trim());
  } else {
    throw httpError(400, message);
  }
  // Không phải số nguyên an toàn - quá lớn hoặc có phần thập phân
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw httpError(400, message);
  }
  return value;
}

// Format số tiền để hiển thị, ví dụ: 100000 -> 100.000đ
function formatVnd(n) {
  if (n === 0 || n === "0") return "0đ";
  const amount = parseAmount(n);
  return `${amount.toLocaleString("vi-VN")}đ`;
}

// Lời nhắn dùng cho giao dịch
function amountRangeMessage(label, { min, max }) {
  return `Số tiền ${label} phải từ ${formatVnd(min)} và tối đa là ${formatVnd(max)}`;
}

// kiểm tra số tiền có nằm trong khoảng cho phép hay không
function parseAmountInRange(raw, rule, label) {
  const message = amountRangeMessage(label, rule);
  const value = parseAmount(raw, message);
  if (value < rule.min || value > rule.max) throw httpError(400, message);
  return value;
}

module.exports = { parseAmount, parseAmountInRange, formatVnd };
