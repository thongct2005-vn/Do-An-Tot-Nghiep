const isValidPhone = (phone) => {
  if (!phone) return false;
  const phoneRegex = /^(03|05|07||08|09)\d{8}$/;
  return phoneRegex.test(phone);
};

const isValidPasswordOrPin = (data) => {
  if (!data) return false;
  const passwordRegex = /^\d{6}$/;
  return passwordRegex.test(data);
};

module.exports = {
  isValidPhone,
  isValidPasswordOrPin,
};
