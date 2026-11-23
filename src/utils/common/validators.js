const isValidPhone = (phone) => {
  if (typeof phone !== "string" || !phone) return false;
  const phoneRegex = /^(03|05|07|08|09)\d{8}$/;
  return phoneRegex.test(phone);
};

const isValidPasswordOrPin = (data) => {
  if (typeof data !== "string" || !data) return false;
  const passwordRegex = /^\d{6}$/;
  return passwordRegex.test(data);
};

const isValidPasswordMerchant = (data) => {
  if (typeof data !== "string" || !data) return false;
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8,15}$/;
  return passwordRegex.test(data);
};

const isValidEmail = (email) => {
  if (typeof email !== "string" || !email) return false;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};
const isValidPhonesHash = (phones) => {
  const PHONE_HASH_PATTERN = /^[0-9a-f]{64}$/i;
  if (
    phones.some((p) => typeof p !== "string" || !PHONE_HASH_PATTERN.test(p))
  ) {
    return false;
  }
  return true;
};

function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isValidOtp(code) {
  return isValidPasswordOrPin(code);
}

/**
 * Chuẩn hóa và kiểm tra trường địa chỉ merchant trước khi lưu vào `user_kyc.address`.
 */
function normalizeMerchantAddress(value) {
  if (value === undefined || value === null) {
    return { valid: true, value: null };
  }
  if (typeof value !== "string") {
    return { valid: false, message: "Địa chỉ phải là chuỗi hoặc null" };
  }
  const trimmed = value.trim();
  if (trimmed.includes("\0")) {
    return { valid: false, message: "Địa chỉ chứa ký tự không hợp lệ" };
  }
  if ([...trimmed].length > 255) {
    return { valid: false, message: "Địa chỉ không được vượt quá 255 ký tự" };
  }
  return { valid: true, value: trimmed.length > 0 ? trimmed : null };
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAST4_DIGITS_REGEX = /^\d{4}$/;
const REFERENCE_CODE_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_MERCHANT_EMAIL_LENGTH = 255;
const MAX_PAYMENT_DESCRIPTION_LENGTH = 500;

function createHttpError(statusCode, message) {
  const { httpError } = require("./http");
  return httpError(statusCode, message);
}

function isValidUuid(value) {
  return UUID_REGEX.test(String(value || "").trim());
}

function assertValidUuid(value, message = "ID không hợp lệ") {
  const normalized = String(value || "").trim();
  if (!isValidUuid(normalized)) {
    throw createHttpError(400, message);
  }
  return normalized;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function assertValidTrimmedString(
  value,
  messageOrLabel,
  { min = 1, max = 500, isFullMessage = false } = {},
) {
  if (typeof value !== "string") {
    throw createHttpError(
      400,
      isFullMessage ? messageOrLabel : `${messageOrLabel} không hợp lệ`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw createHttpError(
      400,
      isFullMessage ? messageOrLabel : `Vui lòng nhập ${messageOrLabel}`,
    );
  }
  if (trimmed.length > max) {
    throw createHttpError(
      400,
      isFullMessage
        ? messageOrLabel
        : `${messageOrLabel} không được vượt quá ${max} ký tự`,
    );
  }
  return trimmed;
}

function assertValidDescription(
  value,
  {
    required = false,
    max = MAX_PAYMENT_DESCRIPTION_LENGTH,
    emptyMessage = "Nội dung không được để trống",
    invalidMessage = "Nội dung phải là chuỗi ký tự hợp lệ",
    tooLongMessage,
  } = {},
) {
  if (value === undefined || value === null) {
    if (required) throw createHttpError(400, emptyMessage);
    return "";
  }
  if (typeof value !== "string") {
    throw createHttpError(400, invalidMessage);
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    throw createHttpError(400, emptyMessage);
  }
  if (trimmed.length > max) {
    throw createHttpError(
      400,
      tooLongMessage || `Nội dung không được vượt quá ${max} ký tự`,
    );
  }
  return trimmed;
}

function parseSafeIntField(
  value,
  { label = "Giá trị", min = 0, max = Number.MAX_SAFE_INTEGER, allowNull = false } = {},
) {
  if (value === undefined || value === null || value === "") {
    if (allowNull) return null;
    throw createHttpError(400, `Thiếu thông tin ${label}`);
  }
  const num = Number(value);
  if (!Number.isInteger(num) || !Number.isSafeInteger(num)) {
    throw createHttpError(400, `${label} phải là số nguyên hợp lệ`);
  }
  if (num < min || num > max) {
    throw createHttpError(400, `${label} phải nằm trong khoảng từ ${min} đến ${max}`);
  }
  return num;
}

module.exports = {
  UUID_REGEX,
  LAST4_DIGITS_REGEX,
  REFERENCE_CODE_REGEX,
  MAX_MERCHANT_EMAIL_LENGTH,
  MAX_PAYMENT_DESCRIPTION_LENGTH,
  isValidPhone,
  isValidPasswordOrPin,
  isValidEmail,
  isValidPasswordMerchant,
  isValidPhonesHash,
  isValidDateOnly,
  isValidOtp,
  normalizeMerchantAddress,
  isValidUuid,
  assertValidUuid,
  isPlainObject,
  assertValidTrimmedString,
  assertValidDescription,
  parseSafeIntField,
};
