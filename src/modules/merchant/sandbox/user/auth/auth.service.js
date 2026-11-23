// auth.service.js: Nghiệp vụ kiểm tra tồn tại, đăng nhập và đăng ký tài khoản User Sandbox.
const authRepository = require("./auth.repository");
const bcrypt = require("bcrypt");
const {
  isValidPhone,
  isValidPasswordOrPin,
  isValidEmail,
} = require("../../../../../utils/common/validators");
const { uuidv7 } = require("uuidv7");
const tokenUtil = require("../../../../../utils/auth/jwt");
const { emitToUser, disconnectUser } = require("../../../../../utils/notifications/socket");
const { httpError } = require("../../../../../utils/common/http");
const {
  hashPhoneSha256,
  buildBasicUserInfo,
} = require("../../../../../utils/auth/authHelpers");
const { checkSandboxUserCredentials } = require("../../auth/auth.helpers");

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
    const user = await checkSandboxUserCredentials(
      authRepository,
      phone,
      password,
    );

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
      user_info: buildBasicUserInfo(user),
    };
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

  async register({ phone, email, password }) {
    if (!phone || !email || !password) {
      throw httpError(400, "Thiếu số điện thoại, email hoặc mật khẩu!");
    }
    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }
    if (!isValidEmail(email)) {
      throw httpError(400, "Email không hợp lệ");
    }
    if (!isValidPasswordOrPin(password)) {
      throw httpError(400, "Mật khẩu không hợp lệ");
    }

    const existingPhone = await authRepository.findUserByPhone(phone);
    const existingEmail = await authRepository.findUserByEmail(email);
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

    await authRepository.createUserWithKyc({
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
