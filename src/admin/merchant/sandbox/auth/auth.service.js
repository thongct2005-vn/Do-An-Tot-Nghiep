const { validateCallbackUrlSyntax } = require("../../../../utils/urlGuard");
const merchantAuthRepository = require("./auth.repository");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const {
  isValidPhone,
  isValidEmail,
} = require("../../../../utils/validators");
const { uuidv7 } = require("uuidv7");
const tokenUtil = require("../../../../utils/jwt");
const { emitToUser, disconnectUser } = require("../../../../utils/socket");
const { httpError } = require("../../../../utils/httpError");
const {
  generateUniqueMerchantApiKey,
  generateUniqueMerchantSecretKey,
} = require("../../../../utils/generateApikeySecretkey");
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 30;

async function checkCredentials(phone, password) {
  if (!phone || !password) {
    throw httpError(400, "Thiếu số điện thoại hoặc mật khẩu");
  }

  if (!isValidPhone(phone)) {
    throw httpError(400, "Số điện thoại không hợp lệ");
  }

  const user = await merchantAuthRepository.findMerchantByPhone(phone);

  if (!user) {
    throw httpError(404, "Số điện thoại chưa đăng ký tài khoản");
  }

  if (!user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
  }

  if (user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản bị khóa");
  }

  if (user.role !== "MERCHANT") {
    throw httpError(403, "Tài khoản không hợp lệ");
  }

  if (user.locked_until) {
    if (user.is_locked) {
      throw httpError(403, "Tài khoản bị tạm khóa");
    }
    await merchantAuthRepository.resetFailedLogin(phone);
    user.failed_login_attempts = 0;
    user.locked_until = null;
  }

  const isCorrectPassword = await bcrypt.compare(password, user.password_hash);
  if (!isCorrectPassword) {
    const row = await merchantAuthRepository.registerFailedLogin({
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

  await merchantAuthRepository.resetFailedLogin(phone);
  return user;
}

const merchantAuthService = {
  async isPhoneExist(phone) {
    if (!phone) {
      throw httpError(400, "Thiếu số điện thoại");
    }

    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }

    const user = await merchantAuthRepository.findMerchantByPhone(phone);
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

    const user = await merchantAuthRepository.findMerchantByEmail(email);
    return {
      is_email_exists: user != null,
    };
  },

  async login({ phone, password }) {
    const user = await checkCredentials(phone, password);

    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens(user);
    await merchantAuthRepository.updateRefeshToken({
      refreshToken,
      userId: user.id,
    });

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
    await merchantAuthRepository.logout(userId);
    disconnectUser(userId);
  },

  async refreshToken(token) {
    const user = await merchantAuthRepository.findMerchantByRefreshToken(token);
    if (!user) {
      throw httpError(
        401,
        "Tài khoản của bạn đã được đăng nhập trên thiết bị khác. Vui lòng đăng nhập lại",
      );
    }
    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens(user);
    await merchantAuthRepository.updateRefeshToken({
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

  async register({
    phone,
    email,
    password,
    callbackUrl,
    storeName,
  }) {
    if (!phone || !email) {
      throw httpError(400, "Thiếu số điện thoại hoặc email!");
    }

    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }

    if (!isValidEmail(email)) {
      throw httpError(400, "Email không hợp lệ");
    }

    if (!password) {
      throw httpError(400, "Thiếu mật khẩu");
    }


    if (!callbackUrl) {
      throw httpError(400, "Thiếu callback");
    }
    try {
      validateCallbackUrlSyntax(callbackUrl);
    } catch (e) {
      throw httpError(400, e.message);
    }
    if (!storeName) {
      throw httpError(400, "Thiếu tên cửa hàng");
    }

    const existingPhone =
      await merchantAuthRepository.findMerchantByPhone(phone);
    const existingEmail =
      await merchantAuthRepository.findMerchantByEmail(email);
    if (existingPhone) {
      throw httpError(409, "Số điện thoại đã tồn tại");
    }

    if (existingEmail) {
      throw httpError(409, "Email đã tồn tại");
    }

    const userId = uuidv7();
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const phoneHash = crypto.createHash("sha256").update(phone).digest("hex");
    const apiKey = await generateUniqueMerchantApiKey();
    const secretKey = await generateUniqueMerchantSecretKey();

    await merchantAuthRepository.addMerchant({
      userId,
      phone,
      phoneHash,
      email,
      passwordHash,
      storeName,
      callbackUrl,
      apiKey,
      secretKey,
    });

    const newUser = await merchantAuthRepository.findMerchantByPhone(phone);
    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens(newUser);
    await merchantAuthRepository.updateRefeshToken({
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

module.exports = merchantAuthService;