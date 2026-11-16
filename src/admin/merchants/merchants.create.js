const { httpError } = require("../../utils/httpError");
const { isValidPhone, isValidEmail } = require("../../utils/validators");
const { validateCallbackUrlForSave } = require("../../utils/url/urlGuard");

const ALLOWED_CREATE_FIELDS = new Set([
  "full_name",
  "store_name",
  "phone",
  "email",
  "tax_code",
  "call_back_url",
  "address",
  "reason",
]);

const TAX_CODE_REGEX = /^\d{10}(-\d{3})?$/;

function trimmedString(value, label, min, max) {
  if (typeof value !== "string") {
    throw httpError(400, `${label} phải là chuỗi`);
  }
  const trimmed = value.trim();
  if (trimmed.includes("\0")) {
    throw httpError(400, `${label} chứa ký tự không hợp lệ`);
  }
  const length = [...trimmed].length;
  if (length < min || length > max) {
    throw httpError(400, `${label} phải từ ${min} đến ${max} ký tự`);
  }
  return trimmed;
}

async function parseCreateMerchantPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Dữ liệu tạo đối tác merchant không hợp lệ");
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_CREATE_FIELDS.has(key)) {
      throw httpError(400, `Trường '${key}' không được phép gửi khi tạo merchant`);
    }
  }

  const hasFullName = Object.hasOwn(body, "full_name") && body.full_name !== undefined && body.full_name !== null;
  const hasStoreName = Object.hasOwn(body, "store_name") && body.store_name !== undefined && body.store_name !== null;

  if (!hasFullName && !hasStoreName) {
    throw httpError(400, "Tên đối tác merchant là bắt buộc");
  }

  let fullName;
  if (hasFullName) {
    fullName = trimmedString(body.full_name, "Tên merchant", 2, 50);
  }
  if (hasStoreName) {
    const storeName = trimmedString(body.store_name, "Tên merchant", 2, 50);
    if (fullName !== undefined && fullName !== storeName) {
      throw httpError(400, "Tên chủ tài khoản và tên cửa hàng không được khác nhau");
    }
    fullName = storeName;
  }

  if (!Object.hasOwn(body, "phone") || body.phone === undefined || body.phone === null) {
    throw httpError(400, "Số điện thoại là bắt buộc");
  }
  const phone = trimmedString(body.phone, "Số điện thoại", 10, 10);
  if (!isValidPhone(phone)) {
    throw httpError(400, "Số điện thoại không hợp lệ");
  }

  if (!Object.hasOwn(body, "email") || body.email === undefined || body.email === null) {
    throw httpError(400, "Email là bắt buộc");
  }
  const email = trimmedString(body.email, "Email", 1, 100).toLowerCase();
  if (!isValidEmail(email)) {
    throw httpError(400, "Địa chỉ email không đúng định dạng");
  }

  if (!Object.hasOwn(body, "tax_code") || body.tax_code === undefined || body.tax_code === null) {
    throw httpError(400, "Mã số thuế là bắt buộc");
  }
  const taxCode = trimmedString(body.tax_code, "Mã số thuế", 10, 50);
  if (!TAX_CODE_REGEX.test(taxCode)) {
    throw httpError(400, "Mã số thuế không hợp lệ (10 chữ số hoặc định dạng 10 số-3 số)");
  }

  let callbackUrl = null;
  if (Object.hasOwn(body, "call_back_url") && body.call_back_url !== undefined && body.call_back_url !== null) {
    if (typeof body.call_back_url !== "string") {
      throw httpError(400, "Callback URL phải là chuỗi hoặc null");
    }
    const rawCallback = body.call_back_url.trim();
    if (rawCallback.includes("\0")) {
      throw httpError(400, "Callback URL chứa ký tự không hợp lệ");
    }
    if (rawCallback.length > 0) {
      callbackUrl = await validateCallbackUrlForSave(rawCallback, {
        maxLength: 500,
        allowPrivate:
          process.env.NODE_ENV !== "production" &&
          process.env.ALLOW_PRIVATE_CALLBACKS === "true",
      });
    }
  }

  let address = null;
  if (Object.hasOwn(body, "address") && body.address !== undefined && body.address !== null) {
    if (typeof body.address !== "string") {
      throw httpError(400, "Địa chỉ phải là chuỗi hoặc null");
    }
    const rawAddress = body.address.trim();
    if (rawAddress.includes("\0")) {
      throw httpError(400, "Địa chỉ chứa ký tự không hợp lệ");
    }
    if ([...rawAddress].length > 255) {
      throw httpError(400, "Địa chỉ không được vượt quá 255 ký tự");
    }
    address = rawAddress.length > 0 ? rawAddress : null;
  }

  if (!Object.hasOwn(body, "reason") || body.reason === undefined || body.reason === null) {
    throw httpError(400, "Lý do tạo merchant là bắt buộc");
  }
  const reason = trimmedString(body.reason, "Lý do tạo merchant", 5, 500);

  return {
    values: {
      full_name: fullName,
      phone,
      email,
      tax_code: taxCode,
      call_back_url: callbackUrl,
      address,
    },
    reason,
  };
}

module.exports = {
  ALLOWED_CREATE_FIELDS,
  TAX_CODE_REGEX,
  parseCreateMerchantPayload,
};
