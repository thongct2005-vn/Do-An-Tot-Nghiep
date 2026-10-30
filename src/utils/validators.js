const isValidPhone = (phone) => {
  if (!phone) return false;
  const phoneRegex = /^(03|05|07|08|09)\d{8}$/;
  return phoneRegex.test(phone);
};

const isValidPasswordOrPin = (data) => {
  if (!data) return false;
  const passwordRegex = /^\d{6}$/;
  return passwordRegex.test(data);
};

const isValidPasswordMerchant = (data) => {
  if (!data) return false;
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,15}$/;
  return passwordRegex.test(data);
};

const isValidEmail = (email) => {
  if (!email) return false;
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

 

module.exports = {
  isValidPhone,
  isValidPasswordOrPin,
  isValidEmail,
  isValidPasswordMerchant,
  isValidPhonesHash,
  isValidDateOnly,
  isValidOtp
};
