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

module.exports = {
  isValidPhone,
  isValidPasswordOrPin,
  isValidEmail,
  isValidPasswordMerchant
};