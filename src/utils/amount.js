const { httpError } = require("./httpError");
function parseAmount(raw, message = "Số tiền không hợp lệ") {
  let value;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    value = Number(raw.trim());
  } else {
    throw httpError(400, message);
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw httpError(400, message);
  }
  return value;
}

function formatVnd(n) {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000} triệu`;
  if (n >= 1_000 && n % 1_000 === 0) return `${n / 1_000} nghìn`;
  return `${n.toLocaleString("vi-VN")}đ`;
}

function amountRangeMessage(label, { min, max }) {
  return `Số tiền ${label} phải từ ${formatVnd(min)} và tối đa là ${formatVnd(max)}`;
}

function parseAmountInRange(raw, rule, label) {
  const message = amountRangeMessage(label, rule);
  const value = parseAmount(raw, message);
  if (value < rule.min || value > rule.max) throw httpError(400, message);
  return value;
}


module.exports = { parseAmount, parseAmountInRange };
