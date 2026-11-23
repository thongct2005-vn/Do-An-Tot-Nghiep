// auth.helpers.js: Hàm kiểm tra thông tin đăng nhập quản trị viên tách khỏi tầng adminAuthService.
const adminAuthRepository = require("./auth.repository");
const { httpError } = require("../../utils/common/http");
const { isValidEmail } = require("../../utils/common/validators");
const { LOGIN_LOCKOUT_DEFAULTS } = require("../../utils/auth/authHelpers");
const {
  assertAccountBasicEligibility,
  verifyPasswordWithLockout,
} = require("../../utils/auth/authHelpers");

async function checkAdminCredentials(email, password) {
  if (!email || !password) {
    throw httpError(400, "Thiếu email hoặc mật khẩu");
  }

  if (!isValidEmail(email)) {
    throw httpError(400, "Định dạng email không hợp lệ");
  }

  const user = await adminAuthRepository.findAdminByEmail(email);
  await assertAccountBasicEligibility({
    user,
    expectedRole: "ADMIN",
    requireEmail: false,
    notFoundMessage: "Tài khoản không tồn tại",
    wrongRoleMessage: "Tài khoản không có quyền Quản trị viên",
    resetFailedLogin: (id) => adminAuthRepository.resetFailedLogin(id),
    identifier: email,
  });

  return verifyPasswordWithLockout({
    user,
    password,
    identifier: email,
    registerFailedLogin: () =>
      adminAuthRepository.registerFailedLogin({
        email,
        maxAttempts: LOGIN_LOCKOUT_DEFAULTS.MAX_ATTEMPTS,
        lockMinutes: LOGIN_LOCKOUT_DEFAULTS.LOCK_MINUTES,
      }),
    resetFailedLogin: (id) => adminAuthRepository.resetFailedLogin(id),
    resetOnSuccess: true,
    detailedErrorMessage: true,
  });
}

module.exports = {
  checkAdminCredentials,
};

