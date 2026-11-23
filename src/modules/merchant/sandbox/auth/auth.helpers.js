// auth.helpers.js: Kiểm tra thông tin đăng nhập dành riêng cho Merchant Sandbox và User Sandbox.
const { httpError } = require("../../../../utils/common/http");
const { isValidPhone, isValidPasswordOrPin } = require("../../../../utils/common/validators");
const { LOGIN_LOCKOUT_DEFAULTS } = require("../../../../utils/auth/authHelpers");
const {
  assertAccountBasicEligibility,
  verifyPasswordWithLockout,
} = require("../../../../utils/auth/authHelpers");

async function checkSandboxMerchantCredentials(repository, phone, password) {
  if (!phone || !password) {
    throw httpError(400, "Thiếu số điện thoại hoặc mật khẩu");
  }
  if (!isValidPhone(phone)) {
    throw httpError(400, "Số điện thoại không hợp lệ");
  }

  const user = await repository.findMerchantByPhone(phone);
  await assertAccountBasicEligibility({
    user,
    expectedRole: "MERCHANT",
    resetFailedLogin: (id) => repository.resetFailedLogin(id),
    identifier: phone,
  });

  if (!user.password_hash) {
    throw httpError(
      403,
      "Tài khoản chưa thiết lập mật khẩu. Vui lòng sử dụng chức năng Quên mật khẩu để kích hoạt tài khoản",
    );
  }

  return verifyPasswordWithLockout({
    user,
    password,
    identifier: phone,
    registerFailedLogin: () =>
      repository.registerFailedLogin({
        phone,
        maxAttempts: LOGIN_LOCKOUT_DEFAULTS.MAX_ATTEMPTS,
        lockMinutes: LOGIN_LOCKOUT_DEFAULTS.LOCK_MINUTES,
      }),
    resetFailedLogin: (id) => repository.resetFailedLogin(id),
    resetOnSuccess: true,
    detailedErrorMessage: false,
  });
}

async function checkSandboxUserCredentials(repository, phone, password) {
  if (!phone || !password) {
    throw httpError(400, "Thiếu số điện thoại hoặc mật khẩu");
  }
  if (!isValidPhone(phone) || !isValidPasswordOrPin(password)) {
    throw httpError(400, "Số điện thoại hoặc mật khẩu không hợp lệ");
  }

  const user = await repository.findUserByPhone(phone);
  await assertAccountBasicEligibility({
    user,
    expectedRole: "USER",
    resetFailedLogin: (id) => repository.resetFailedLogin(id),
    identifier: phone,
  });

  return verifyPasswordWithLockout({
    user,
    password,
    identifier: phone,
    registerFailedLogin: () =>
      repository.registerFailedLogin({
        phone,
        maxAttempts: LOGIN_LOCKOUT_DEFAULTS.MAX_ATTEMPTS,
        lockMinutes: LOGIN_LOCKOUT_DEFAULTS.LOCK_MINUTES,
      }),
    resetFailedLogin: (id) => repository.resetFailedLogin(id),
    resetOnSuccess: true,
    detailedErrorMessage: false,
  });
}

module.exports = {
  checkSandboxMerchantCredentials,
  checkSandboxUserCredentials,
};

