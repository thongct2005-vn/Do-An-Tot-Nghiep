const crypto = require("crypto");
const { httpError } = require("./httpError");
const { parseAmount } = require("./amount");

// Với mỗi loại giao dịch: danh sách trường trong body mà PIN token phải "ký" vào.
const PIN_ACTIONS = {
  TRANSFER: ["destination_user_id", "amount"],
  TOPUP: ["linked_bank_account_id", "amount"],
  WITHDRAW: ["linked_bank_account_id", "amount"],
  QR_PAYMENT: ["reference_code"],
  BANK_LINK: ["bank_id"],
};

const FIELD_LABELS = {
  destination_user_id: "người nhận tiền",
  linked_bank_account_id: "tài khoản ngân hàng liên kết",
  reference_code: "mã tham chiếu thanh toán",
  bank_id: "ngân hàng",
  amount: "số tiền giao dịch",
};

// Chuẩn hóa 1 trường về dạng chuỗi sạch để so sánh nhất quán
function normalizeField(name, value) {
  if (name === "amount") return String(parseAmount(value));
  const label = FIELD_LABELS[name] || "giao dịch";
  if (typeof value !== "string" && typeof value !== "number") {
    throw httpError(400, `Thiếu hoặc không hợp lệ thông tin ${label}`);
  }
  const text = String(value).trim();
  if (!text) throw httpError(400, `Thiếu hoặc không hợp lệ thông tin ${label}`);
  return text;
}

// Tạo binding: băm (action + giá trị các trường) thành 1 chuỗi hex 64 ký tự
function computePinBinding(action, params) {
  const fields = PIN_ACTIONS[action];
  if (!fields) throw httpError(400, "Loại giao dịch không hợp lệ");

  // params là body của request, phải là object -> { destination_user_id: 42, amount: 50000 }
  if (!params || typeof params !== "object") {
    throw httpError(400, "Thiếu dữ liệu giao dịch để xác thực PIN");
  }

  // Lấy đúng các trường cần ký, chuẩn hóa từng giá trị
  const values = fields.map((field) => normalizeField(field, params[field]));

  // Băm JSON dạng mảng [action, giá trị1, giá trị2...]
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([action, ...values]))
    .digest("hex");
}

module.exports = { PIN_ACTIONS, computePinBinding };
