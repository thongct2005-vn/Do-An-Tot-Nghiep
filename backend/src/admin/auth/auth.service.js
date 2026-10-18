const bcrypt = require("bcrypt");
const adminAuthRepository = require("./auth.repository");
const tokenUtil = require("../../utils/jwt");
const { httpError } = require("../../utils/httpError");
const { isValidEmail } = require("../../utils/validators");

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 30;

async function checkAdminCredentials(email, password) {
  if (!email || !password) {
    throw httpError(400, "Thiếu email hoặc mật khẩu");
  }

  if (!isValidEmail(email)) {
    throw httpError(400, "Định dạng email không hợp lệ");
  }

  const user = await adminAuthRepository.findAdminByEmail(email);
  if (!user) {
    throw httpError(404, "Tài khoản không tồn tại");
  }

  if (user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản bị khóa");
  }

  if (user.role !== "ADMIN") {
    throw httpError(403, "Tài khoản không có quyền Quản trị viên");
  }

  if (user.locked_until) {
    if (user.is_locked) {
      throw httpError(403, "Tài khoản bị tạm khóa");
    }
    await adminAuthRepository.resetFailedLogin(email);
    user.failed_login_attempts = 0;
    user.locked_until = null;
  }

  const isCorrectPassword = await bcrypt.compare(password, user.password_hash);
  if (!isCorrectPassword) {
    const row = await adminAuthRepository.registerFailedLogin({
      email,
      maxAttempts: MAX_LOGIN_ATTEMPTS,
      lockMinutes: LOGIN_LOCK_MINUTES,
    });
    const attempts = Number(row?.failed_login_attempts ?? MAX_LOGIN_ATTEMPTS);
    const isLocked = attempts >= MAX_LOGIN_ATTEMPTS;
    const err = httpError(
      isLocked ? 403 : 400,
      isLocked ? "Tài khoản bị tạm khóa" : "Mật khẩu không chính xác",
    );
    err.remainingAttempts = Math.max(MAX_LOGIN_ATTEMPTS - attempts, 0);
    throw err;
  }

  await adminAuthRepository.resetFailedLogin(email);
  return user;
}

const adminAuthService = {
  async login({ email, password }) {
    const user = await checkAdminCredentials(email, password);

    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens({
      id: user.id,
      phone: undefined,
      full_name: user.full_name,
      role: user.role,
    });

    await adminAuthRepository.updateRefreshToken({
      refreshToken,
      userId: user.id,
    });

    return {
      token: {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      admin_info: {
        user_id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    };
  },
};

module.exports = adminAuthService;
