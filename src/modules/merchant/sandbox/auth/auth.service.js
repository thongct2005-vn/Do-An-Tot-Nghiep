// auth.service.js: Nghiệp vụ đăng nhập, làm mới phiên, đổi mật khẩu lần đầu và đăng ký Merchant Sandbox.
const merchantAuthRepository = require("./auth.repository");
const bcrypt = require("bcrypt");
const {
  isValidPhone,
  isValidEmail,
  normalizeMerchantAddress,
} = require("../../../../utils/common/validators");
const { uuidv7 } = require("uuidv7");
const tokenUtil = require("../../../../utils/auth/jwt");
const { emitToUser, disconnectUser } = require("../../../../utils/notifications/socket");
const { httpError } = require("../../../../utils/common/http");
const {
  generateUniqueMerchantApiKey,
  generateUniqueMerchantSecretKey,
} = require("../../../../utils/security/keys");
const {
  buildFirstLoginChallenge,
  changeFirstLoginPassword,
} = require("../../shared/firstLoginPassword");
const { validateCallbackUrlForSave } = require("../../../../utils/security/url");
const {
  hashPhoneSha256,
  buildBasicUserInfo,
} = require("../../../../utils/auth/authHelpers");
const { checkSandboxMerchantCredentials } = require("./auth.helpers");

const merchantAuthService = {
  async login({ phone, password }) {
    const user = await checkSandboxMerchantCredentials(
      merchantAuthRepository,
      phone,
      password,
    );

    if (user.must_change_password === true) {
      return buildFirstLoginChallenge(user);
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
      user_info: buildBasicUserInfo(user),
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
    if (user.must_change_password === true) {
      throw httpError(
        403,
        "Vui lòng đổi mật khẩu tạm thời và đăng nhập lại trước khi tiếp tục",
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
    });
  },

  async register({
    phone,
    email,
    password,
    callbackUrl,
    storeName,
    address,
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
    const safeCallbackUrl = await validateCallbackUrlForSave(callbackUrl);
    if (!storeName) {
      throw httpError(400, "Thiếu tên cửa hàng");
    }
    const normalizedAddress = normalizeMerchantAddress(address);
    if (!normalizedAddress.valid) {
      throw httpError(400, normalizedAddress.message);
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
    const phoneHash = hashPhoneSha256(phone);
    const apiKey = await generateUniqueMerchantApiKey();
    const secretKey = await generateUniqueMerchantSecretKey();

    await merchantAuthRepository.addMerchant({
      userId,
      phone,
      phoneHash,
      email,
      passwordHash,
      storeName,
      address: normalizedAddress.value,
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
