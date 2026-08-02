const { successResponse } = require('../../utils/apiResponse');
const authService = require('./auth.service');

const authController = {
  async isPhoneExist(req, res, next) {
    try {
      const { phone } = req.body;
      const result = await authService.isPhoneExist(phone);
      return successResponse(
        res,
        200,
        'Kiểm tra số điện thoại thành công',
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  /*Login----------------------------------------- */

  async login(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await authService.login({ phone, password });
      return successResponse(res, 200, 'Đăng nhập thành công', result);
    } catch (e) {
      next(e);
    }
  },

  async refreshToken(req, res, next) {
    try {
      const { refresh_token: refreshToken } = req.body;
      const result = await authService.refreshToken( refreshToken );
      return successResponse(res, 200, 'Làm mới token thành công', result);
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
      return successResponse(res, 200, 'Lấy thông tin người dùng thành công', result);
    } catch (e) {
      next(e);
    }
  },

  /*Register----------------------------------------- */

  async register(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await authService.register({ phone, password });
      return successResponse(res, 200, 'Tạo tài khoản thành công', result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = authController;
