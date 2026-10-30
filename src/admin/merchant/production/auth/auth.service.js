const merchantAuthRepository = require("./auth.repository");
const otpService = require("../../../../modules/otp/otp.service");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const {
  isValidPhone,
  isValidPasswordMerchant,
  isValidEmail,
} = require("../../../../utils/validators");
const { uuidv7 } = require("uuidv7");
const tokenUtil = require("../../../../utils/jwt");
const totpUtil = require("../../../../utils/totp");
const { emitToUser } = require("../../../../utils/socket");
const { httpError } = require("../../../../utils/httpError");
const { validateCallbackUrlForSave } = require("../../../../utils/urlGuard");
const {
  generateUniqueMerchantApiKey,
  generateUniqueMerchantSecretKey,
} = require("../../../../utils/generateApikeySecretkey");
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 30;
const TOTP_MAX_ATTEMPTS = 5;
const TOTP_LOCK_MINUTES = 5;
const TOTP_ISSUER = process.env.TOTP_MERCHANT_ISSUER;

const { maskEmail } = require("../../../../utils/mask");

async function checkCredentials(phone, password) {
  if (!phone || !password) {
    throw httpError(400, "Thiếu số điện thoại hoặc mật khẩu");
  }

  if (!isValidPhone(phone) || !isValidPasswordMerchant(password)) {
    throw httpError(400, "Số điện thoại hoặc mật khẩu không hợp lệ");
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

// Kiểm tra mã 6 số của Google Authenticator.
// requireEnabled = true: đăng nhập / tắt; false: bước xác nhận bật lần đầu.
async function verifyTotpCode({ userId, code, requireEnabled }) {
  if (!/^\d{6}$/.test(String(code ?? ""))) {
    throw httpError(400, "Mã xác thực phải gồm 6 chữ số");
  }

  const state = await merchantAuthRepository.getTotpState(userId);
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
    const row = await merchantAuthRepository.registerTotpFailure({
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

  const consumed = await merchantAuthRepository.consumeTotpStep({
    userId,
    step,
  });
  if (!consumed) {
    throw httpError(400, "Mã đã được sử dụng, vui lòng đợi mã mới");
  }
}

async function getOtpMerchant({ userId, phone }) {
  const user = await merchantAuthRepository.findMerchantByPhone(phone);
  if (
    !user ||
    user.id !== userId ||
    user.status !== "ACTIVE" ||
    user.role !== "MERCHANT"
  ) {
    throw httpError(401, "Phiên xác thực không hợp lệ");
  }

  if (!user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
  }

  return user;
}

const merchantAuthService = {
  // Dùng chung cho OTP giao dịch khi merchant đã bật Google Authenticator
  async verifyEnabledTotp({ userId, code }) {
    await verifyTotpCode({ userId, code, requireEnabled: true });
  },

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

    // Đã bật Google Authenticator: không gửi email, merchant nhập mã từ ứng dụng
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
    const user = await getOtpMerchant({ userId, phone });

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
    const user = await getOtpMerchant({ userId, phone });

    if (user.totp_enabled) {
      await verifyTotpCode({
        userId: user.id,
        code: otp,
        requireEnabled: true,
      });
    } else {
      await otpService.verifyOtp({ email: user.email, otp });
    }

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

  // ===== Google Authenticator (TOTP) =====

  async getTotpStatus(userId) {
    const state = await merchantAuthRepository.getTotpState(userId);
    return { totp_enabled: state?.totp_enabled === true };
  },

  // Tạo khoá + mã QR. Merchant đã đăng nhập nhưng vẫn phải nhập lại mật khẩu;
  // chưa bật cho tới khi nhập mã đầu tiên (enableTotp).
  async setupTotp({ userId, phone, password }) {
    const user = await checkCredentials(phone, password);
    if (user.id !== userId) {
      throw httpError(403, "Tài khoản không hợp lệ");
    }

    if (user.totp_enabled) {
      throw httpError(409, "Tài khoản đã bật Google Authenticator");
    }

    const secret = totpUtil.generateSecret();
    const saved = await merchantAuthRepository.saveTotpSecret({
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

  async enableTotp({ userId, code }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    await verifyTotpCode({ userId, code, requireEnabled: false });
    const enabled = await merchantAuthRepository.enableTotp(userId);
    if (!enabled) {
      throw httpError(
        409,
        "Không thể bật Google Authenticator, vui lòng thử lại",
      );
    }
  },

  // Tắt phải nhập đúng mã hiện tại của ứng dụng (khác app: ở đây không có
  // bước đăng nhập ngay trước đó để chứng minh người dùng còn giữ thiết bị)
  async disableTotp({ userId, code }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    await verifyTotpCode({ userId, code, requireEnabled: true });
    await merchantAuthRepository.disableTotp(userId);
  },

  async logout(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để đăng xuất");
    }
    await merchantAuthRepository.logout(userId);
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

  async verifyAndCompleteRegister({
    userId,
    phone,
    email,
    otp,
    password,
    taxCode,
    callbackUrl,
    storeName,
  }) {
    if (!password) {
      throw httpError(400, "Thiếu mật khẩu");
    }

    if (!isValidPasswordMerchant(password)) {
      throw httpError(400, "Mật khẩu không hợp lệ");
    }

    if (!taxCode) {
      throw httpError(400, "Thiếu mã số thuế");
    }
    if (!callbackUrl) {
      throw httpError(400, "Thiếu callback");
    }
    if (!storeName) {
      throw httpError(400, "Thiếu tên cửa hàng");
    }
    const safeCallbackUrl = await validateCallbackUrlForSave(callbackUrl);

    await otpService.verifyOtp({ email, phone, otp });

    const existingUser =
      await merchantAuthRepository.findMerchantByPhone(phone);
    if (existingUser) {
      throw httpError(409, "Tài khoản đã tồn tại");
    }

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
      taxCode,
      callbackUrl: safeCallbackUrl,
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
