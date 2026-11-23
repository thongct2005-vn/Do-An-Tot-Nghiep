// auth.helpers.js: Các hàm hỗ trợ kiểm tra thông tin đăng nhập, TOTP và phiên OTP người dùng.
const { httpError } = require("../../utils/common/http");
const { isValidPhone, isValidPasswordOrPin } = require("../../utils/common/validators");
const {
  LOGIN_LOCKOUT_DEFAULTS,
  TOTP_POLICY_DEFAULTS,
} = require("../../utils/auth/authHelpers");

const TOTP_ISSUER = process.env.TOTP_ISSUER;
const {
  assertAccountBasicEligibility,
  verifyPasswordWithLockout,
  createTotpVerifier,
} = require("../../utils/auth/authHelpers");

function createUserAuthHelpers({ authRepository }) {
  const verifyTotpCode = createTotpVerifier({
    repository: authRepository,
    policy: TOTP_POLICY_DEFAULTS,
  });

  async function checkCredentials(phone, password) {
    if (!phone || !password) {
      throw httpError(400, "Thiếu số điện thoại hoặc mật khẩu");
    }
    if (!isValidPhone(phone) || !isValidPasswordOrPin(password)) {
      throw httpError(400, "Số điện thoại hoặc mật khẩu không hợp lệ");
    }

    const user = await authRepository.findUserByPhone(phone);
    await assertAccountBasicEligibility({
      user,
      expectedRole: "USER",
      resetFailedLogin: (id) => authRepository.resetFailedLogin(id),
      identifier: phone,
    });

    return verifyPasswordWithLockout({
      user,
      password,
      identifier: phone,
      registerFailedLogin: () =>
        authRepository.registerFailedLogin({
          phone,
          maxAttempts: LOGIN_LOCKOUT_DEFAULTS.MAX_ATTEMPTS,
          lockMinutes: LOGIN_LOCKOUT_DEFAULTS.LOCK_MINUTES,
        }),
      resetOnSuccess: false,
      detailedErrorMessage: true,
    });
  }

  async function getOtpUser({ userId, phone }) {
    const user = await authRepository.findUserByPhone(phone);
    if (
      !user ||
      user.id !== userId ||
      user.status !== "ACTIVE" ||
      user.role === "merchant"
    ) {
      throw httpError(401, "Phiên xác thực không hợp lệ");
    }
    if (!user.email) {
      throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
    }
    return user;
  }

  return {
    checkCredentials,
    verifyTotpCode,
    getOtpUser,
  };
}

module.exports = {
  TOTP_ISSUER,
  createUserAuthHelpers,
};
