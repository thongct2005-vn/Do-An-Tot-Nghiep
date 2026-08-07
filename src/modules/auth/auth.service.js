const pool = require("../../config/database");
const authRepository = require("./auth.repository");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
require("dotenv").config();
const {
  isValidPhone,
  isValidPasswordOrPin,
} = require("../../utils/validators");
const { uuidv7 } = require("uuidv7");
const jwt = require("jsonwebtoken");
const tokenUtil = require("../../utils/jwt");
const ACCESS_SECRET = process.env.ACCESS_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;

const authService = {
  async isPhoneExist(phone) {
    if (!phone) {
      const err = new Error("Thiếu số điện thoại");
      err.statusCode = 400;
      throw err;
    }

    if (!isValidPhone(phone)) {
      const err = new Error("Số điện thoại không hợp lệ");
      err.statusCode = 400;
      throw err;
    }

    const user = await authRepository.findUserByPhone(phone);
    return {
      is_phone_exists: user != null,
    };
  },

  async login({ phone, password }) {
    if (!phone || !password) {
      const err = new Error("Thiếu số điện thoại hoặc mật khẩu");
      err.statusCode = 400;
      throw err;
    }

    if (!isValidPhone(phone) || !isValidPasswordOrPin(password)) {
      const err = new Error("Số điện thoại hoặc mật khẩu không hợp lệ");
      err.statusCode = 400;
      throw err;
    }

    const user = await authRepository.findUserByPhone(phone);
    if (!user) {
      const err = new Error("Số điện thoại chưa đăng ký tài khoản");
      err.statusCode = 404;
      throw err;
    }

    const { id: userId, full_name: fullName, wallet_id: walletId } = user;

    if (user.locked_until) {
      if (user.is_locked) {
        const err = new Error("Tài khoản bị tạm khóa");
        err.statusCode = 403;
        throw err;
      }

      await authRepository.resetFailedLogin(phone);
      user.failed_login_attempts = 0;
      user.locked_until = null;
    }

    const isCorrectPassword = await bcrypt.compare(
      password,
      user.password_hash,
    );
    if (!isCorrectPassword) {
      const attempts = Number(user.failed_login_attempts || 0) + 1;
      const lockMinutes = attempts >= 5 ? 30 : 0;
      await authRepository.updateFailedLogin({ phone, attempts, lockMinutes });
      const err = new Error(
        attempts >= 5 ? "Tài khoản bị tạm khóa" : "Mật khẩu không chính xác",
      );
      err.remainingAttempts = Math.max(5 - attempts, 0);
      err.statusCode = attempts >= 5 ? 403 : 400;
      throw err;
    }

    await authRepository.resetFailedLogin(user.phone);

    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens(user);

    await authRepository.updateRefeshToken({ refreshToken, userId });
    return {
      token: {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      user_info: {
        user_id: userId,
        phone: phone,
        full_name: fullName,
        wallet_id: walletId,
      },
    };
  },

  async refreshToken(token) {
    const user = await authRepository.findUserByRefreshToken(token);
    if (!user) {
      const err = new Error(
        "Tài khoản của bạn đã được đăng nhập trên thiết bị khác. Vui lòng đăng nhập lại",
      );
      err.statusCode = 401;
      throw err;
    }
    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens(user);
    const userId = user.id;
    await authRepository.updateRefeshToken({ refreshToken, userId });

    return {
      token: {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    };
  },

  async register({ phone, password }) {
    if (!phone || !password) {
      const err = new Error("Thiếu số điện thoại hoặc mật khẩu!");
      err.statusCode = 400;
      throw err;
    }

    if (!isValidPhone(phone) || !isValidPasswordOrPin(password)) {
      const err = new Error("Số điện thoại hoặc mật khẩu không hợp lệ");
      err.statusCode = 400;
      throw err;
    }

    const user = await authRepository.findUserByPhone(phone);
    if (user) {
      const err = new Error("Tài khoản đã tồn tại");
      err.statusCode = 409;
      throw err;
    }

    const userId = uuidv7();
    const walletId = uuidv7();
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const phoneHash = crypto.createHash("sha256").update(phone).digest("hex");
    await authRepository.addUser({userId, walletId, phone, phoneHash, passwordHash});
    return {
      user_info: {
        user_id: userId,
        wallet_id: walletId,
      },
    };
  },
};

module.exports = authService;
