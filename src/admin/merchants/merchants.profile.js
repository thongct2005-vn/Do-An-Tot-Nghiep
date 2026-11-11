const { httpError } = require("../../utils/httpError");
const { isValidPhone, isValidEmail } = require("../../utils/validators");
const { validateCallbackUrlForSave } = require("../../utils/urlGuard");

const PROFILE_FIELDS = ["full_name", "phone", "email", "call_back_url"];
const REQUEST_FIELDS = new Set([...PROFILE_FIELDS, "store_name", "reason"]);

function trimmedString(value, label, min, max) {
  if (typeof value !== "string") throw httpError(400, `${label} phải là chuỗi`);
  const trimmed = value.trim();
  if (trimmed.includes("\0")) throw httpError(400, `${label} chứa ký tự không hợp lệ`);
  const length = [...trimmed].length;
  if (length < min || length > max) {
    throw httpError(400, `${label} phải từ ${min} đến ${max} ký tự`);
  }
  return trimmed;
}

async function parseProfilePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Nội dung cập nhật hồ sơ không hợp lệ");
  }
  if (Object.keys(body).some(key => !REQUEST_FIELDS.has(key))) {
    throw httpError(400, "Có trường không được phép cập nhật trong hồ sơ merchant");
  }
  const reason = trimmedString(body.reason, "Lý do chỉnh sửa", 5, 500);
  const values = {};
  if (Object.hasOwn(body, "full_name")) {
    values.full_name = trimmedString(body.full_name, "Tên merchant", 2, 50);
  }
  if (Object.hasOwn(body, "store_name")) {
    const alias = trimmedString(body.store_name, "Tên merchant", 2, 50);
    if (values.full_name !== undefined && values.full_name !== alias) {
      throw httpError(400, "full_name và store_name không được khác nhau");
    }
    values.full_name = alias;
  }
  if (Object.hasOwn(body, "phone")) {
    const phone = trimmedString(body.phone, "Số điện thoại", 10, 10);
    if (!isValidPhone(phone)) throw httpError(400, "Số điện thoại không hợp lệ");
    values.phone = phone;
  }
  if (Object.hasOwn(body, "email")) {
    const email = trimmedString(body.email, "Email", 1, 100).toLowerCase();
    if (!isValidEmail(email)) throw httpError(400, "Địa chỉ email không đúng định dạng");
    values.email = email;
  }
  if (Object.hasOwn(body, "call_back_url")) {
    if (body.call_back_url !== null && typeof body.call_back_url !== "string") {
      throw httpError(400, "Callback URL phải là chuỗi hoặc null");
    }
    const callback = body.call_back_url?.trim() || null;
    if (callback?.includes("\0")) throw httpError(400, "Callback URL chứa ký tự không hợp lệ");
    values.call_back_url = callback === null ? null : await validateCallbackUrlForSave(callback, {
      maxLength: 500,
      // The development escape hatch must never weaken this production endpoint.
      allowPrivate: process.env.NODE_ENV !== "production" && process.env.ALLOW_PRIVATE_CALLBACKS === "true",
    });
  }
  if (Object.keys(values).length === 0) throw httpError(400, "Chưa có thông tin hồ sơ cần cập nhật");
  return { values, reason };
}

function comparableProfileValue(field, value) {
  const trimmed = typeof value === "string" ? value.trim() : value;
  if (field === "email") return trimmed?.toLowerCase() ?? null;
  if (field === "call_back_url") return trimmed || null;
  return trimmed ?? null;
}

module.exports = { PROFILE_FIELDS, parseProfilePatch, comparableProfileValue };
