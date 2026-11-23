const sharedFirstLogin = require("../../../utils/auth/authHelpers");

function buildFirstLoginChallenge(user) {
  return sharedFirstLogin.buildFirstLoginChallenge(user, {
    purpose: "merchant_first_login_change",
  });
}

async function changeFirstLoginPassword(params) {
  return sharedFirstLogin.changeFirstLoginPassword({
    ...params,
    allowedRole: "MERCHANT",
  });
}

module.exports = {
  buildFirstLoginChallenge,
  changeFirstLoginPassword,
};
