const crypto = require("crypto");
const { httpError } = require("./httpError");
const { parseAmount } = require("./amount");

// Mỗi loại giao dịch cần PIN và các trường của request mà PIN token phải "ký" vào.
// Tên trường trùng với tên trường trong body của endpoint tương ứng.
const PIN_ACTIONS = {
  TRANSFER: ["destination_user_id", "amount"],
  TOPUP: ["linked_bank_account_id", "amount"],
  WITHDRAW: ["linked_bank_account_id", "amount"],
  QR_PAYMENT: ["reference_code"],
  BANK_LINK: ["bank_id"],
};

function normalizeField(name, value) {
  if (name === "amount") return String(parseAmount(value));
  if (typeof value !== "string" && typeof value !== "number") {
    throw httpError(400, `Thiếu hoặc sai trường ${name}`);
  }
  const text = String(value).trim();
  if (!text) throw httpError(400, `Thiếu hoặc sai trường ${name}`);
  return text;
}

// Băm (action + các trường) thành 1 chuỗi cố định. JSON.stringify dạng mảng để
// các giá trị không thể "dính" vào nhau (vd "a|b" + "c" khác "a" + "b|c").
function computePinBinding(action, params) {
  const fields = PIN_ACTIONS[action];
  if (!fields) throw httpError(400, "Loại giao dịch không hợp lệ");
  if (!params || typeof params !== "object") {
    throw httpError(400, "Thiếu dữ liệu giao dịch để xác thực PIN");
  }
  const values = fields.map((field) => normalizeField(field, params[field]));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([action, ...values]))
    .digest("hex");
}

module.exports = { PIN_ACTIONS, computePinBinding };