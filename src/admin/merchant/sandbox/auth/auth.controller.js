const { successResponse } = require("../../../../utils/apiResponse");
const merchantAuthService = require("./auth.service");

const merchantAuthController = {
  async isPhoneExist(req, res, next) {
    try {
      const { phone } = req.body;
      const result = await merchantAuthService.isPhoneExist(phone);
      return successResponse(
        res,
        200,
        "Kiểm tra số điện thoại thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async isEmailExist(req, res, next) {
    try {
      const { email } = req.body;
      const result = await merchantAuthService.isEmailExist(email);
      return successResponse(res, 200, "Kiểm tra email thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async login(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await merchantAuthService.login({ phone, password });
      return successResponse(
        res,
        200,
        "Đăng nhập thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async logout(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      await merchantAuthService.logout(userId);
      return successResponse(res, 200, "Đăng xuất thành công");
    } catch (e) {
      next(e);
    }
  },

  async refreshToken(req, res, next) {
    try {
      const { refresh_token: refreshToken } = req.body;
      const result = await merchantAuthService.refreshToken(refreshToken);
      return successResponse(res, 200, "Làm mới token thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async getMe(req, res, next) {
    try {
      const { user_id: userId, phone, full_name: fullName } = req.user;
      const result = {
        user_info: {
          user_id: userId,
          phone: phone,
          full_name: fullName,
        },
      };
      return successResponse(
        res,
        200,
        "Lấy thông tin người dùng thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async register(req, res, next) {
    try {
      const {
        phone,
        email,
        password,
        call_back_url: callbackUrl,
        store_name: storeName,
      } = req.body;
      const result = await merchantAuthService.register({
        phone,
        email,
        password,
        callbackUrl,
        storeName,
      });
      return successResponse(res, 200, "Đăng ký tài khoản thành công", result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = merchantAuthController;