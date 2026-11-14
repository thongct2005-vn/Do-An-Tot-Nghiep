const merchantAuthRepository = require("./auth.repository");
const otpService = require("../../../otp/otp.service");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const {
  isValidPhone,
  isValidPasswordMerchant,
  isValidEmail,
  isValidOtp,
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
    const remainingAttempts = Math.max(MAX_LOGIN_ATTEMPTS - attempts, 0);
    const isLocked = attempts >= MAX_LOGIN_ATTEMPTS;
    const err = httpError(
      isLocked ? 403 : 400,
      isLocked
        ? `Bạn đã nhập sai mật khẩu ${MAX_LOGIN_ATTEMPTS} lần. Tài khoản bị tạm khóa ${LOGIN_LOCK_MINUTES} phút`
        : `Mật khẩu không chính xác. Bạn còn ${remainingAttempts} lần thử`,
    );
    err.remainingAttempts = remainingAttempts;
    throw err;
  }

  const priorFailedAttempts = Number(user.failed_login_attempts || 0);
  await merchantAuthRepository.resetFailedLogin(phone);
  user.prior_failed_attempts = priorFailedAttempts;
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

function assertMerchantForgotEligible(user) {
  if (!user) {
    throw httpError(404, "Số điện thoại chưa đăng ký tài khoản");
  }
  if (user.role !== "MERCHANT") {
    throw httpError(403, "Tài khoản không hợp lệ");
  }
  if (user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản bị khóa");
  }
  if (!user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
  }
  if (!user.tax_code) {
    throw httpError(
      403,
      "Tài khoản chưa có mã số thuế định danh (KYC), vui lòng liên hệ hỗ trợ",
    );
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

  async login({ phone, password, riskChallenge = false }) {
    const user = await checkCredentials(phone, password);

    const hasTaxCode = Boolean(
      user.tax_code && String(user.tax_code).trim().length >= 4,
    );
    const requireTaxCodeLast4 =
      Boolean(riskChallenge || (user.prior_failed_attempts >= 2)) && hasTaxCode;

    const otpToken = tokenUtil.generateOtpToken(user, "login_otp", {
      require_tax_code_last4: requireTaxCodeLast4,
    });

    // Đã bật Google Authenticator: không gửi email, merchant nhập mã từ ứng dụng
    if (user.totp_enabled) {
      return {
        otp_token: otpToken,
        masked_email: maskEmail(user.email),
        otp_method: "totp",
        require_tax_code_last4: requireTaxCodeLast4,
      };
    }

    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return {
      otp_token: otpToken,
      masked_email: maskEmail(user.email),
      otp_method: "email",
      require_tax_code_last4: requireTaxCodeLast4,
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

  async verifyLoginOtp({
    userId,
    phone,
    otp,
    taxCodeLast4 = null,
    requireTaxCodeLast4 = false,
  }) {
    const user = await getOtpMerchant({ userId, phone });

    if (requireTaxCodeLast4) {
      const expectedLast4 = user.tax_code
        ? String(user.tax_code).trim().slice(-4)
        : null;
      if (expectedLast4) {
        if (!taxCodeLast4 || !/^\d{4}$/.test(String(taxCodeLast4).trim())) {
          throw httpError(
            400,
            "Vui lòng nhập kèm 4 số cuối Mã số thuế để xác minh bảo mật",
          );
        }
        if (String(taxCodeLast4).trim() !== expectedLast4) {
          throw httpError(400, "4 số cuối Mã số thuế không chính xác");
        }
      }
    }

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
    feePlan,
  }) {
    const merchantFeeService = require("../fee/fee.service");
    const normalizedFeePlan = merchantFeeService.normalizeRequestedPlan(
      feePlan,
      { defaultPlan: "PER_TRANSACTION" },
    );
    if (!password) {
      throw httpError(400, "Thiếu mật khẩu");
    }

    if (!isValidPasswordMerchant(password)) {
      throw httpError(
        400,
        "Mật khẩu phải từ 8 đến 15 ký tự, có ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số, 1 ký tự đặc biệt và không chứa khoảng trắng",
      );
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
      feePlan: normalizedFeePlan,
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
        fee_plan: normalizedFeePlan,
      },
    };
  },

  // ===== Quên mật khẩu Merchant (Email OTP hoặc Google Authenticator + Mã số thuế KYC) =====

  async forgotPasswordRequest({ phone }) {
    if (!phone) {
      throw httpError(400, "Thiếu số điện thoại");
    }
    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }

    const user =
      await merchantAuthRepository.findMerchantForForgotByPhone(phone);
    assertMerchantForgotEligible(user);

    const otpToken = tokenUtil.generateOtpToken(user, "merchant_forgot_otp");

    if (user.totp_enabled) {
      return {
        otp_token: otpToken,
        otp_method: "totp",
        masked_email: maskEmail(user.email),
      };
    }

    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return {
      otp_token: otpToken,
      otp_method: "email",
      masked_email: maskEmail(user.email),
    };
  },

  async forgotPasswordResendOtp({ userId, phone }) {
    const user =
      await merchantAuthRepository.findMerchantForForgotByPhone(phone);
    if (!user || user.id !== userId) {
      throw httpError(401, "Phiên xác thực không hợp lệ");
    }
    assertMerchantForgotEligible(user);

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

  async forgotPasswordVerify({ userId, phone, otp, taxCode }) {
    const code = String(otp ?? "").trim();
    const normalizedTaxCode = String(taxCode ?? "").trim();

    if (!code) {
      throw httpError(400, "Vui lòng nhập mã xác thực");
    }
    if (!isValidOtp(code)) {
      throw httpError(400, "Mã xác thực phải gồm 6 chữ số");
    }
    if (!normalizedTaxCode) {
      throw httpError(400, "Vui lòng nhập mã số thuế");
    }

    const user =
      await merchantAuthRepository.findMerchantForForgotByPhone(phone);
    if (!user || user.id !== userId) {
      throw httpError(401, "Phiên xác thực không hợp lệ");
    }
    assertMerchantForgotEligible(user);

    if (normalizedTaxCode !== String(user.tax_code).trim()) {
      throw httpError(400, "Mã số thuế không chính xác");
    }

    if (user.totp_enabled) {
      await verifyTotpCode({
        userId: user.id,
        code,
        requireEnabled: true,
      });
    } else {
      await otpService.verifyOtp({ email: user.email, otp: code });
    }

    const version = tokenUtil.credentialVersion(user.password_hash);
    return {
      otp_token: tokenUtil.generateOtpToken(
        user,
        "merchant_forgot_otp_verified",
        { pv: version },
        "10m",
      ),
      tax_code_token: tokenUtil.generateTaxCodeToken({
        userId: user.id,
        taxCode: user.tax_code,
        version,
      }),
    };
  },

  async forgotPasswordReset({
    userId,
    version,
    taxCodeHash,
    password,
    confirmPassword,
  }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    if (!password) {
      throw httpError(400, "Thiếu mật khẩu mới");
    }
    if (!confirmPassword) {
      throw httpError(400, "Vui lòng xác nhận lại mật khẩu");
    }
    if (password !== confirmPassword) {
      throw httpError(400, "Mật khẩu xác nhận không khớp");
    }
    if (!isValidPasswordMerchant(password)) {
      throw httpError(
        400,
        "Mật khẩu phải từ 8 đến 15 ký tự, có ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số, 1 ký tự đặc biệt và không chứa khoảng trắng",
      );
    }

    const user = await merchantAuthRepository.findMerchantForResetById(userId);
    if (!user) {
      throw httpError(404, "Không tìm thấy tài khoản");
    }
    if (user.role !== "MERCHANT" || user.status !== "ACTIVE") {
      throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
    }
    if (
      !user.tax_code ||
      tokenUtil.hashToken(String(user.tax_code).trim()) !== taxCodeHash
    ) {
      throw httpError(401, "Phiên xác thực mã số thuế không hợp lệ");
    }
    if (tokenUtil.credentialVersion(user.password_hash) !== version) {
      throw httpError(
        401,
        "Phiên đặt lại mật khẩu đã hết hiệu lực, vui lòng thực hiện lại",
      );
    }

    if (
      user.password_hash &&
      (await bcrypt.compare(password, user.password_hash))
    ) {
      throw httpError(400, "Mật khẩu mới không được trùng mật khẩu hiện tại");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const updated = await merchantAuthRepository.resetPassword({
      userId,
      passwordHash,
      oldPasswordHash: user.password_hash,
    });
    if (!updated) {
      throw httpError(
        401,
        "Phiên đặt lại mật khẩu đã hết hiệu lực, vui lòng thực hiện lại",
      );
    }

    emitToUser(userId, "force_logout", {
      reason: "Mật khẩu của tài khoản vừa được đặt lại. Vui lòng đăng nhập lại",
    });
  },

  // ===== Đổi mật khẩu Merchant khi đã đăng nhập (OTP Email hoặc Google Authenticator -> mật khẩu cũ + mới) =====

  async changePasswordRequest({ userId }) {
    const user = await merchantAuthRepository.findMerchantById(userId);
    assertActiveMerchantUser(user);

    const otpToken = tokenUtil.generateOtpToken(
      user,
      "merchant_change_password_otp",
    );

    if (user.totp_enabled) {
      return {
        otp_token: otpToken,
        otp_method: "totp",
        masked_email: user.email ? maskEmail(user.email) : "",
      };
    }

    if (!user.email) {
      throw httpError(404, "Không tìm thấy email liên kết với tài khoản");
    }

    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return {
      otp_token: otpToken,
      otp_method: "email",
      masked_email: maskEmail(user.email),
    };
  },

  async changePasswordResendOtp({ userId }) {
    const user = await merchantAuthRepository.findMerchantById(userId);
    assertActiveMerchantUser(user);

    if (user.totp_enabled) {
      throw httpError(
        400,
        "Tài khoản đang dùng Google Authenticator, không có mã gửi qua email",
      );
    }
    if (!user.email) {
      throw httpError(404, "Không tìm thấy email liên kết với tài khoản");
    }

    await otpService.generateAndSaveOtp({ email: user.email });

    return {
      masked_email: maskEmail(user.email),
    };
  },

  async changePasswordVerify({ userId, otp }) {
    const user = await merchantAuthRepository.findMerchantById(userId);
    assertActiveMerchantUser(user);

    await verifyMerchantOtpOrTotp(user, otp);

    const version = tokenUtil.credentialVersion(user.password_hash);
    return {
      otp_token: tokenUtil.generateOtpToken(
        user,
        "merchant_change_password_verified",
        { pv: version },
        "10m",
      ),
    };
  },

  async changePasswordReset({
    userId,
    version,
    oldPassword,
    newPassword,
    confirmPassword,
  }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    if (!oldPassword) {
      throw httpError(400, "Vui lòng nhập mật khẩu hiện tại");
    }
    if (!newPassword) {
      throw httpError(400, "Thiếu mật khẩu mới");
    }
    if (!confirmPassword) {
      throw httpError(400, "Vui lòng xác nhận lại mật khẩu");
    }
    if (newPassword !== confirmPassword) {
      throw httpError(400, "Mật khẩu xác nhận không khớp");
    }
    if (!isValidPasswordMerchant(newPassword)) {
      throw httpError(
        400,
        "Mật khẩu phải từ 8 đến 15 ký tự, có ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số, 1 ký tự đặc biệt và không chứa khoảng trắng",
      );
    }
    if (oldPassword === newPassword) {
      throw httpError(400, "Mật khẩu mới không được trùng mật khẩu hiện tại");
    }

    const user = await merchantAuthRepository.findMerchantById(userId);
    assertActiveMerchantUser(user);

    if (tokenUtil.credentialVersion(user.password_hash) !== version) {
      throw httpError(
        403,
        "Phiên đặt lại mật khẩu đã hết hiệu lực, vui lòng thực hiện lại",
      );
    }

    const isOldCorrect = user.password_hash
      ? await bcrypt.compare(oldPassword, user.password_hash)
      : false;
    if (!isOldCorrect) {
      throw httpError(400, "Mật khẩu hiện tại không chính xác");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    const updated = await merchantAuthRepository.resetPassword({
      userId,
      passwordHash,
      oldPasswordHash: user.password_hash,
    });
    if (!updated) {
      throw httpError(
        403,
        "Phiên đặt lại mật khẩu đã hết hiệu lực, vui lòng thực hiện lại",
      );
    }

    emitToUser(userId, "force_logout", {
      reason: "Mật khẩu của tài khoản vừa được đặt lại. Vui lòng đăng nhập lại",
    });
  },

  // ===== Đổi email Merchant (đang đăng nhập) =====

  // Bước 1: Kiểm tra mật khẩu hiện tại, phát OTP email hoặc TOTP + otp_token bước 1
  async changeEmailRequest({ userId, password }) {
    if (!password) {
      throw httpError(400, "Vui lòng nhập mật khẩu hiện tại");
    }

    const user = await merchantAuthRepository.findMerchantById(userId);
    assertActiveMerchantUser(user);

    const isPasswordCorrect = await bcrypt.compare(
      String(password),
      user.password_hash,
    );
    if (!isPasswordCorrect) {
      throw httpError(400, "Mật khẩu hiện tại không chính xác");
    }

    const meta = buildChangeEmailTokenMeta(user);
    if (user.totp_enabled) {
      return {
        otp_token: tokenUtil.generateOtpToken(
          user,
          "merchant_change_email_otp",
          meta,
        ),
        otp_method: "totp",
        masked_email: maskEmail(user.email),
      };
    }

    if (!user.email) {
      throw httpError(404, "Không tìm thấy email liên kết với tài khoản");
    }

    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return {
      otp_token: tokenUtil.generateOtpToken(
        user,
        "merchant_change_email_otp",
        meta,
      ),
      otp_method: "email",
      masked_email: maskEmail(user.email),
    };
  },

  // Gửi lại OTP cho email hiện tại (chỉ khi không dùng TOTP)
  async changeEmailResendOtp({ userId, emailVersion, passwordVersion }) {
    const user = await merchantAuthRepository.findMerchantById(userId);
    assertActiveMerchantUser(user);
    assertChangeEmailTokenFresh(user, { emailVersion, passwordVersion });

    if (user.totp_enabled) {
      throw httpError(
        400,
        "Tài khoản đang bật Google Authenticator, không cần gửi lại OTP email",
      );
    }
    if (!user.email) {
      throw httpError(404, "Không tìm thấy email liên kết với tài khoản");
    }

    await otpService.generateAndSaveOtp({ email: user.email });
    return {
      otp_token: tokenUtil.generateOtpToken(
        user,
        "merchant_change_email_otp",
        buildChangeEmailTokenMeta(user),
      ),
      otp_method: "email",
      masked_email: maskEmail(user.email),
    };
  },

  // Bước 2: Xác thực OTP (email cũ) hoặc TOTP -> trả otp_token bước 2 cho bước nhập email mới
  async changeEmailVerify({ userId, otp, emailVersion, passwordVersion }) {
    const user = await merchantAuthRepository.findMerchantById(userId);
    assertActiveMerchantUser(user);
    assertChangeEmailTokenFresh(user, { emailVersion, passwordVersion });

    await verifyMerchantOtpOrTotp(user, otp);

    return {
      otp_token: tokenUtil.generateOtpToken(
        user,
        "merchant_change_email_verified",
        buildChangeEmailTokenMeta(user),
      ),
    };
  },

  // Bước 3: Kiểm tra email mới hợp lệ & chưa trùng, gửi OTP tới email mới -> trả otp_token bước 3
  async changeEmailSendNewOtp({
    userId,
    newEmail,
    emailVersion,
    passwordVersion,
  }) {
    return issueNewEmailConfirmOtp({
      userId,
      newEmail,
      emailVersion,
      passwordVersion,
      ignoreCooldown: true,
    });
  },

  // Gửi lại OTP cho email mới trong bước 4
  async changeEmailResendNewOtp({
    userId,
    newEmail,
    emailVersion,
    passwordVersion,
  }) {
    return issueNewEmailConfirmOtp({
      userId,
      newEmail,
      emailVersion,
      passwordVersion,
      ignoreCooldown: false,
    });
  },

  // Bước 4: Xác thực OTP gửi về email mới -> cập nhật users.email (atomic claimEmail)
  async changeEmailConfirm({
    userId,
    otp,
    newEmail,
    emailVersion,
    passwordVersion,
  }) {
    const code = String(otp ?? "").trim();
    if (!code) {
      throw httpError(400, "Vui lòng nhập mã OTP xác thực");
    }
    if (!isValidOtp(code)) {
      throw httpError(400, "Mã OTP phải gồm 6 chữ số");
    }

    const user = await merchantAuthRepository.findMerchantById(userId);
    assertActiveMerchantUser(user);
    assertChangeEmailTokenFresh(user, { emailVersion, passwordVersion });

    const normalizedNewEmail = normalizeEmail(newEmail);
    if (!normalizedNewEmail || !isValidEmail(normalizedNewEmail)) {
      throw httpError(
        403,
        "Phiên đổi email không hợp lệ, vui lòng thực hiện lại",
      );
    }
    if (normalizedNewEmail === normalizeEmail(user.email)) {
      throw httpError(400, "Email mới phải khác email hiện tại");
    }

    await otpService.verifyOtp({ email: normalizedNewEmail, otp: code });

    const updated = await merchantAuthRepository.updateEmail({
      userId: user.id,
      newEmail: normalizedNewEmail,
      oldEmail: user.email,
      oldPasswordHash: user.password_hash,
    });
    if (!updated) {
      throw httpError(
        403,
        "Phiên đổi email đã hết hiệu lực, vui lòng thực hiện lại",
      );
    }

    return {
      email: updated.email,
      masked_email: maskEmail(updated.email),
    };
  },
};

const MAX_MERCHANT_EMAIL_LENGTH = 100;

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function buildChangeEmailTokenMeta(user) {
  return {
    pv: tokenUtil.credentialVersion(user.password_hash),
    ev: tokenUtil.credentialVersion(user.email),
  };
}

function assertChangeEmailTokenFresh(user, { emailVersion, passwordVersion }) {
  const current = buildChangeEmailTokenMeta(user);
  if (
    !emailVersion ||
    !passwordVersion ||
    emailVersion !== current.ev ||
    passwordVersion !== current.pv
  ) {
    throw httpError(
      403,
      "Phiên đổi email đã hết hiệu lực, vui lòng thực hiện lại",
    );
  }
}

async function assertAvailableNewEmail(user, newEmail) {
  const normalized = normalizeEmail(newEmail);
  if (!normalized) {
    throw httpError(400, "Vui lòng nhập email mới");
  }
  if (normalized.length > MAX_MERCHANT_EMAIL_LENGTH) {
    throw httpError(
      400,
      `Email mới không được vượt quá ${MAX_MERCHANT_EMAIL_LENGTH} ký tự`,
    );
  }
  if (!isValidEmail(normalized)) {
    throw httpError(400, "Email mới không hợp lệ");
  }
  if (normalized === normalizeEmail(user.email)) {
    throw httpError(400, "Email mới phải khác email hiện tại");
  }
  const claimed = await merchantAuthRepository.isEmailClaimedByOther(
    normalized,
    user.id,
  );
  if (claimed) {
    throw httpError(409, "Địa chỉ email đã được liên kết với tài khoản khác");
  }
  return normalized;
}

async function issueNewEmailConfirmOtp({
  userId,
  newEmail,
  emailVersion,
  passwordVersion,
  ignoreCooldown,
}) {
  const user = await merchantAuthRepository.findMerchantById(userId);
  assertActiveMerchantUser(user);
  assertChangeEmailTokenFresh(user, { emailVersion, passwordVersion });

  const normalizedNewEmail = await assertAvailableNewEmail(user, newEmail);

  try {
    await otpService.generateAndSaveOtp({ email: normalizedNewEmail });
  } catch (e) {
    if (!ignoreCooldown || e.statusCode !== 429) throw e;
  }

  return {
    otp_token: tokenUtil.generateOtpToken(
      user,
      "merchant_change_email_confirm_otp",
      {
        ...buildChangeEmailTokenMeta(user),
        new_email: normalizedNewEmail,
      },
    ),
    masked_new_email: maskEmail(normalizedNewEmail),
  };
}

function assertActiveMerchantUser(user) {
  if (!user) {
    throw httpError(404, "Không tìm thấy tài khoản");
  }
  if (user.role !== "MERCHANT" || user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
  }
}

async function verifyMerchantOtpOrTotp(user, otp) {
  const code = String(otp ?? "").trim();
  if (!code) {
    throw httpError(400, "Vui lòng nhập mã xác thực");
  }
  if (!isValidOtp(code)) {
    throw httpError(400, "Mã xác thực phải gồm 6 chữ số");
  }
  if (user.totp_enabled) {
    await verifyTotpCode({
      userId: user.id,
      code,
      requireEnabled: true,
    });
    return;
  }
  if (!user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với tài khoản");
  }
  await otpService.verifyOtp({ email: user.email, otp: code });
}

module.exports = merchantAuthService;
