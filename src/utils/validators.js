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

module.exports = {
  isValidPhone,
  isValidPasswordOrPin,
  isValidEmail,
  isValidPasswordMerchant,
  isValidPhonesHash,
  isValidDateOnly,
  isValidOtp,
  normalizeMerchantAddress,
};
