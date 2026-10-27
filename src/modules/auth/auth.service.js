const authRepository = require("./auth.repository");
const otpService = require("../otp/otp.service");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const {
  isValidPhone,
  isValidPasswordOrPin,
  isValidEmail,
} = require("../../utils/validators");
const { uuidv7 } = require("uuidv7");
const tokenUtil = require("../../utils/jwt");
const totpUtil = require("../../utils/totp");
const { emitToUser, disconnectUser } = require("../../utils/socket");
const { httpError } = require("../../utils/httpError");
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 30;
const TOTP_MAX_ATTEMPTS = 5;
const TOTP_LOCK_MINUTES = 5;
const TOTP_ISSUER = process.env.TOTP_ISSUER;

const { maskEmail} = require("../../utils/maskPhoneAndEmail");

async function checkCredentials(phone, password) {
  if (!phone || !password) {
    throw httpError(400, "Thiếu số điện thoại hoặc mật khẩu");
  }

  if (!isValidPhone(phone) || !isValidPasswordOrPin(password)) {
    throw httpError(400, "Số điện thoại hoặc mật khẩu không hợp lệ");
  }

  const user = await authRepository.findUserByPhone(phone);

  if (!user) {
    throw httpError(404, "Số điện thoại chưa đăng ký tài khoản");
  }

  if (!user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
  }

  if (user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản bị khóa");
  }

  if (user.role !== "USER") {
    throw httpError(403, "Tài khoản không hợp lệ");
  }

  if (user.locked_until) {
    if (user.is_locked) {
      throw httpError(403, "Tài khoản bị tạm khóa");
    }
    await authRepository.resetFailedLogin(phone);
    user.failed_login_attempts = 0;
    user.locked_until = null;
  }

  const isCorrectPassword = await bcrypt.compare(password, user.password_hash);
  if (!isCorrectPassword) {
    const row = await authRepository.registerFailedLogin({
      phone,
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

  await authRepository.resetFailedLogin(phone);
  return user;
}

// Kiểm tra mã 6 số của Google Authenticator.
// requireEnabled = true: đăng nhập; false: bước xác nhận bật lần đầu.
async function verifyTotpCode({ userId, code, requireEnabled }) {
  if (!/^\d{6}$/.test(String(code ?? ""))) {
    throw httpError(400, "Mã xác thực phải gồm 6 chữ số");
  }

  const state = await authRepository.getTotpState(userId);
  if (!state || !state.totp_secret || state.totp_enabled !== requireEnabled) {
    throw httpError(
      400,
      requireEnabled
        ? "Tài khoản chưa bật Google Authenticator"
        : "Chưa có mã QR để xác nhận, vui lòng quét lại mã QR",
    );
  }
  if (state.is_totp_locked) {
    throw httpError(
      403,
      `Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau ${TOTP_LOCK_MINUTES} phút`,
    );
  }

  const secret = totpUtil.decryptSecret(state.totp_secret);
  const lastStep =
    state.totp_last_step === null ? null : Number(state.totp_last_step);
  const step = totpUtil.verifyCode(secret, code, { lastStep });

  if (step === null) {
    const row = await authRepository.registerTotpFailure({
      userId,
      maxAttempts: TOTP_MAX_ATTEMPTS,
      lockMinutes: TOTP_LOCK_MINUTES,
    });
    const attempts = Number(row?.totp_failed_attempts ?? TOTP_MAX_ATTEMPTS);
    if (attempts >= TOTP_MAX_ATTEMPTS) {
      throw httpError(
        403,
        `Bạn đã nhập sai ${TOTP_MAX_ATTEMPTS} lần. Tạm khóa ${TOTP_LOCK_MINUTES} phút`,
      );
    }
    throw httpError(
      400,
      `Mã không chính xác hoặc đã được sử dụng. Bạn còn ${TOTP_MAX_ATTEMPTS - attempts} lần thử`,
    );
  }

  const consumed = await authRepository.consumeTotpStep({ userId, step });
  if (!consumed) {
    throw httpError(400, "Mã đã được sử dụng, vui lòng đợi mã mới");
  }
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

const authService = {
  async isPhoneExist(phone) {
    if (!phone) {
      throw httpError(400, "Thiếu số điện thoại");
    }

    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }

    const user = await authRepository.findUserByPhone(phone);
    return {
      is_phone_exists: user != null,
      // App dùng để đổi ô tích ở màn mật khẩu: "totp" hoặc "email"
      otp_method: user?.totp_enabled ? "totp" : "email",
    };
  },

  async isEmailExist(email) {
    if (!email) {
      throw httpError(400, "Thiếu email");
    }

    if (!isValidEmail(email)) {
      throw httpError(400, "Email không hợp lệ");
    }

    const user = await authRepository.findUserByEmail(email);
    return {
      is_email_exists: user != null,
    };
  },

  async login({ phone, password }) {
    const user = await checkCredentials(phone, password);

    // Đã bật Google Authenticator: không gửi email, người dùng nhập mã từ ứng dụng
    if (user.totp_enabled) {
      return {
        otp_token: tokenUtil.generateOtpToken(user),
        masked_email: maskEmail(user.email),
        otp_method: "totp",
      };
    }

    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return {
      otp_token: tokenUtil.generateOtpToken(user),
      masked_email: maskEmail(user.email),
      otp_method: "email",
    };
  },

  async resendLoginOtp({ userId, phone }) {
    const user = await getOtpUser({ userId, phone });

    if (user.totp_enabled) {
      throw httpError(
        400,
        "Tài khoản đang dùng Google Authenticator, không có mã gửi qua email",
      );
    }

    await otpService.generateAndSaveOtp({ email: user.email });

    return {
      masked_email: maskEmail(user.email),
    };
  },

  async verifyLoginOtp({ userId, phone, otp }) {
    const user = await getOtpUser({ userId, phone });

    if (user.totp_enabled) {
      await verifyTotpCode({ userId: user.id, code: otp, requireEnabled: true });
    } else {
      await otpService.verifyOtp({ email: user.email, otp });
    }

    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens(user);
    await authRepository.updateRefeshToken({ refreshToken, userId: user.id });

    emitToUser(user.id, "force_logout", {
      reason: "Tài khoản của bạn vừa được đăng nhập ở một thiết bị khác",
    });

    return {
      token: {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      user_info: {
        user_id: user.id,
        phone: user.phone,
        full_name: user.full_name,
      },
    };
  },

  // Tạo khoá + mã QR. Cần đúng mật khẩu; chưa bật cho tới khi nhập mã đầu tiên
  // sau khi đăng nhập (enableTotp), nên chỉ biết mật khẩu thì chưa chiếm được bước 2.
  async setupTotp({ phone, password }) {
    const user = await checkCredentials(phone, password);

    if (user.totp_enabled) {
      throw httpError(409, "Tài khoản đã bật Google Authenticator");
    }

    const secret = totpUtil.generateSecret();
    const saved = await authRepository.saveTotpSecret({
      userId: user.id,
      encryptedSecret: totpUtil.encryptSecret(secret),
    });
    if (!saved) {
      throw httpError(409, "Tài khoản đã bật Google Authenticator");
    }

    return {
      otpauth_uri: totpUtil.buildOtpAuthUri({
        secret,
        account: user.phone,
        issuer: TOTP_ISSUER,
      }),
      secret,
    };
  },

  // Gọi khi đã đăng nhập (OTP email xong): nhập mã đầu tiên để bật
  async enableTotp({ userId, code }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    await verifyTotpCode({ userId, code, requireEnabled: false });
    const enabled = await authRepository.enableTotp(userId);
    if (!enabled) {
      throw httpError(409, "Không thể bật Google Authenticator, vui lòng thử lại");
    }
  },

  async disableTotp(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    await authRepository.disableTotp(userId);
  },

  async logout(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để đăng xuất");
    }
    await authRepository.logout(userId);
    disconnectUser(userId);
  },

  async refreshToken(token) {
    const user = await authRepository.findUserByRefreshToken(token);
    if (!user) {
      throw httpError(
        401,
        "Tài khoản của bạn đã được đăng nhập trên thiết bị khác. Vui lòng đăng nhập lại",
      );
    }
    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens(user);
    await authRepository.updateRefeshToken({
      refreshToken,
      userId: user.id,
    });

    return {
      token: {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    };
  },

  async register({ phone, email }) {
    if (!phone || !email) {
      throw httpError(400, "Thiếu số điện thoại hoặc email!");
    }

    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }

    if (!isValidEmail(email)) {
      throw httpError(400, "Email không hợp lệ");
    }

    const existingPhone = await authRepository.findUserByPhone(phone);
    const existingEmail = await authRepository.findUserByEmail(email);
    if (existingPhone) {
      throw httpError(409, "Số điện thoại đã tồn tại");
    }

    if (existingEmail) {
      throw httpError(409, "Email đã tồn tại");
    }

    try {
      await otpService.generateAndSaveOtp({ email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    const tempUser = { id: uuidv7(), phone, email };

    return {
      otp_token: tokenUtil.generateOtpToken(tempUser, "register_otp"),
    };
  },

  async verifyAndCompleteRegister({ userId, phone, email, otp, password }) {
    if (!password) {
      throw httpError(400, "Thiếu mật khẩu");
    }

    if (!isValidPasswordOrPin(password)) {
      throw httpError(400, "Mật khẩu không hợp lệ");
    }

    await otpService.verifyOtp({ email, phone, otp });

    const existingUser = await authRepository.findUserByPhone(phone);
    if (existingUser) {
      throw httpError(409, "Tài khoản đã tồn tại");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const phoneHash = crypto.createHash("sha256").update(phone).digest("hex");

    await authRepository.addUser({
      userId,
      phone,
      phoneHash,
      email,
      passwordHash,
    });

    const newUser = await authRepository.findUserByPhone(phone);
    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens(newUser);
    await authRepository.updateRefeshToken({
      refreshToken,
      userId: newUser.id,
    });

    return {
      token: {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      user_info: {
        user_id: newUser.id,
        phone: newUser.phone,
        email: newUser.email,
      },
    };
  },
};

module.exports = authService;