// auth.service.js: Nghiệp vụ xác thực đăng nhập, OTP/TOTP, đăng ký và làm mới phiên App User.
const authRepository = require("./auth.repository");
const otpService = require("../otp/otp.service");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const {
  isValidPhone,
  isValidPasswordOrPin,
  isValidEmail,
  isValidOtp,
} = require("../../utils/common/validators");
const { uuidv7 } = require("uuidv7");
const tokenUtil = require("../../utils/auth/jwt");
const totpUtil = require("../../utils/auth/totp");
const { emitToUser, disconnectUser } = require("../../utils/notifications/socket");
const { httpError } = require("../../utils/common/http");
const {
  recordSuccessfulUserLogin,
} = require("../../models/mongo/userLoginEvent.model");
const { maskEmail } = require("../../utils/common/text");
const {
  buildFirstLoginChallenge,
  changeFirstLoginPassword,
} = require("../../utils/auth/authHelpers");
const { TOTP_ISSUER, createUserAuthHelpers } = require("./auth.helpers");

const { checkCredentials, verifyTotpCode, getOtpUser } = createUserAuthHelpers({
  authRepository,
});

const authService = {
  verifyTotpCode,

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

  async login({ phone, password, riskChallenge = false }) {
    const user = await checkCredentials(phone, password);

    const hasApprovedCccd = Boolean(
      user.cccd_number && String(user.cccd_number).trim().length >= 4,
    );
    const requireCccdLast4 =
      hasApprovedCccd &&
      (Boolean(riskChallenge) || Number(user.prior_failed_attempts || 0) >= 2);
    const otpExtra = requireCccdLast4 ? { require_cccd_last4: true } : {};

    // Đã bật Google Authenticator: không gửi email, người dùng nhập mã từ ứng dụng
    if (user.totp_enabled) {
      return {
        otp_token: tokenUtil.generateOtpToken(user, undefined, otpExtra),
        masked_email: maskEmail(user.email),
        otp_method: "totp",
        require_cccd_last4: requireCccdLast4,
      };
    }

    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return {
      otp_token: tokenUtil.generateOtpToken(user, undefined, otpExtra),
      masked_email: maskEmail(user.email),
      otp_method: "email",
      require_cccd_last4: requireCccdLast4,
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

  async verifyLoginOtp({
    userId,
    phone,
    otp,
    cccdLast4,
    requireCccdLast4 = false,
  }) {
    const user = await getOtpUser({ userId, phone });

    if (requireCccdLast4) {
      const inputLast4 = String(cccdLast4 ?? "").trim();
      if (!/^\d{4}$/.test(inputLast4)) {
        throw httpError(
          400,
          "Vui lòng nhập đủ 4 số cuối CCCD để xác minh bảo mật",
        );
      }
      const actualLast4 = String(user.cccd_number ?? "")
        .trim()
        .slice(-4);
      if (!actualLast4 || inputLast4 !== actualLast4) {
        throw httpError(400, "4 số cuối CCCD không chính xác");
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

    if (Number(user.failed_login_attempts || 0) > 0 || user.locked_until) {
      await authRepository.resetFailedLogin(user.phone || phone);
    }

    if (user.must_change_password === true) {
      return buildFirstLoginChallenge(user, {
        purpose: "user_first_login_change",
      });
    }

    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens(user);
    await authRepository.updateRefeshToken({ refreshToken, userId: user.id });

    void recordSuccessfulUserLogin({ userId: user.id }).catch(() => {
      console.warn("MongoDB audit event unavailable: user login write failed");
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

  // Tạo khoá + mã QR. Cần đúng mật khẩu; chưa bật cho tới khi nhập mã đầu tiên
  // sau khi đăng nhập (enableTotp), nên chỉ biết mật khẩu thì chưa chiếm được bước 2.
  async setupTotp({ phone, password }) {
    const user = await checkCredentials(phone, password);
    if (Number(user.failed_login_attempts || 0) > 0 || user.locked_until) {
      await authRepository.resetFailedLogin(phone);
    }

    if (user.must_change_password === true) {
      throw httpError(
        403,
        "Vui lòng đổi mật khẩu tạm thời trước khi thiết lập Google Authenticator",
      );
    }

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

  // Lấy lại mã QR đã liên kết (lỡ xoá mã trong Google Authenticator).
  // Cần đúng mật khẩu; trả về đúng khoá cũ, không tạo khoá mới.
  async recoverTotp({ phone, password }) {
    const user = await checkCredentials(phone, password);
    if (Number(user.failed_login_attempts || 0) > 0 || user.locked_until) {
      await authRepository.resetFailedLogin(phone);
    }

    if (user.must_change_password === true) {
      throw httpError(
        403,
        "Vui lòng đổi mật khẩu tạm thời trước khi khôi phục Google Authenticator",
      );
    }

    if (!user.totp_enabled) {
      throw httpError(400, "Tài khoản chưa bật Google Authenticator");
    }

    const state = await authRepository.getTotpState(user.id);
    if (!state || !state.totp_secret) {
      throw httpError(404, "Không tìm thấy khoá Google Authenticator");
    }

    const secret = totpUtil.decryptSecret(state.totp_secret);
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
      throw httpError(
        409,
        "Không thể bật Google Authenticator, vui lòng thử lại",
      );
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
    if (user.status !== "ACTIVE") {
      throw httpError(403, "Tài khoản bị khóa");
    }
    if (user.must_change_password === true) {
      throw httpError(
        403,
        "Vui lòng đổi mật khẩu tạm thời và đăng nhập lại trước khi tiếp tục",
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

    await otpService.verifyOtp({ email, otp });

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

  async firstLoginChangePassword({
    userId,
    version,
    password,
    confirmPassword,
  }) {
    return changeFirstLoginPassword({
      userId,
      version,
      password,
      confirmPassword,
      allowedRole: "USER",
    });
  },
};

module.exports = authService;
