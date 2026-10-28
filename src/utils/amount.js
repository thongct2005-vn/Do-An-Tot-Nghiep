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

module.exports = { parseAmount };