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
const { emitToUser } = require("../../utils/socket");
const { httpError } = require("../../utils/httpError");
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 30;

function maskEmail(email) {
  const [name, domain] = email.split("@");
  const visible = name.slice(0, Math.min(5, name.length));
  return `${visible}***@${domain}`;
}

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
    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return {
      otp_token: tokenUtil.generateOtpToken(user),
      masked_email: maskEmail(user.email),
    };
  },

  async resendLoginOtp({ userId, phone }) {
    const user = await getOtpUser({ userId, phone });

    await otpService.generateAndSaveOtp({ email: user.email });

    return {
      masked_email: maskEmail(user.email),
    };
  },

  async verifyLoginOtp({ userId, phone, otp }) {
    const user = await getOtpUser({ userId, phone });

    await otpService.verifyOtp({ email: user.email, otp });

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

  async logout(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để đăng xuất");
    }
    await authRepository.logout(userId);
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
