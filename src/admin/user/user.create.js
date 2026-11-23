const { httpError } = require("../../utils/common/http");
const { isValidPhone, isValidEmail } = require("../../utils/common/validators");

const ALLOWED_CREATE_USER_FIELDS = new Set([
  "full_name",
  "phone",
  "email",
  "reason",
]);

const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;
const REASON_CONTROL_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function trimmedString(raw, label, min, max, { allowNewlines = false } = {}) {
  if (typeof raw !== "string") {
    throw httpError(400, `${label} phải là chuỗi ký tự`);
  }
  const trimmed = raw.trim();
  if ((allowNewlines ? REASON_CONTROL_REGEX : CONTROL_CHAR_REGEX).test(trimmed)) {
    throw httpError(400, `${label} chứa ký tự không hợp lệ`);
  }
  const length = [...trimmed].length;
  if (length === 0) {
    throw httpError(400, `${label} là bắt buộc`);
  }
  if (length < min || length > max) {
    throw httpError(400, `${label} phải từ ${min} đến ${max} ký tự`);
  }
  return trimmed;
}

function parseCreateUserPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Dữ liệu tạo tài khoản người dùng không hợp lệ");
  }

  const unexpectedFields = Object.keys(body).filter(
    (key) => !ALLOWED_CREATE_USER_FIELDS.has(key),
  );
  if (unexpectedFields.length > 0) {
    throw httpError(
      400,
      `Trường dữ liệu không được phép: ${unexpectedFields.join(", ")}`,
    );
  }

  if (
    !Object.hasOwn(body, "full_name") ||
    body.full_name === undefined ||
    body.full_name === null
  ) {
    throw httpError(400, "Họ và tên là bắt buộc");
  }
  const fullName = trimmedString(body.full_name, "Họ và tên", 2, 50);

  if (
    !Object.hasOwn(body, "phone") ||
    body.phone === undefined ||
    body.phone === null
  ) {
    throw httpError(400, "Số điện thoại là bắt buộc");
  }
  if (typeof body.phone !== "string") {
    throw httpError(400, "Số điện thoại phải là chuỗi ký tự");
  }
  const phone = body.phone.trim();
  if (CONTROL_CHAR_REGEX.test(phone)) {
    throw httpError(400, "Số điện thoại chứa ký tự không hợp lệ");
  }
  if (!phone) {
    throw httpError(400, "Số điện thoại là bắt buộc");
  }
  if (!isValidPhone(phone)) {
    throw httpError(400, "Số điện thoại không hợp lệ");
  }

  if (
    !Object.hasOwn(body, "email") ||
    body.email === undefined ||
    body.email === null
  ) {
    throw httpError(400, "Email là bắt buộc");
  }
  const email = trimmedString(body.email, "Email", 1, 100).toLowerCase();
  if (!isValidEmail(email)) {
    throw httpError(400, "Địa chỉ email không đúng định dạng");
  }

  if (
    !Object.hasOwn(body, "reason") ||
    body.reason === undefined ||
    body.reason === null
  ) {
    throw httpError(400, "Lý do tạo tài khoản là bắt buộc");
  }
  const reason = trimmedString(body.reason, "Lý do tạo tài khoản", 5, 500, {
    allowNewlines: true,
  });

  return {
    values: {
      full_name: fullName,
      phone,
      email,
    },
    reason,
  };
}

module.exports = {
  ALLOWED_CREATE_USER_FIELDS,
  parseCreateUserPayload,
};
