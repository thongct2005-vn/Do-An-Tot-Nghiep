const { successResponse } = require("../../utils/apiResponse");
const authService = require("./auth.service");

const authController = {
  async isPhoneExist(req, res, next) {
    try {
      const { phone } = req.body;
      const result = await authService.isPhoneExist({ phone });
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

  /*Login----------------------------------------- */

  async login(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await authService.login({ phone, password });
      return successResponse(res, 200, "Đăng nhập thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async refreshToken(req, res, next) {
    try {
      const { refressh_token } = req.body;
      const result = await authService.refreshToken({ refressh_token });
      return successResponse(res, 200, "Làm mới token thành công", result);
    } catch (e) {
      next(e);
    }
  },

  //Lấy thông tin từ accessToken truyền lên
  async getMe(req, res, next) {
    try {
      const { id, phone } = req.user;
      const data = {
        user_info: {
          user_id: id,
          phone: phone,
        },
      };
      return successResponse(res, 200, "Lấy thông tin người dùng thành công", data);
    } catch (e) {
      next(e);
    }
  },

  /*Register----------------------------------------- */

  async register(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await authService.register({ phone, password });
      return successResponse(res, 200, "Tạo tài khoản thành công", result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = authController;
