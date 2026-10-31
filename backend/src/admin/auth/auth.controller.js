const { successResponse } = require("../../utils/apiResponse");
const adminAuthService = require("./auth.service");

const adminAuthController = {
  async login(req, res, next) {
    try {
      console.log("link" + req.originalUrl);
      const { email, password } = req.body;
      const result = await adminAuthService.login({ email, password });
      return successResponse(res, 200, "Đăng nhập Admin thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async refreshToken(req, res, next) {
    try {
      const { refresh_token: token } = req.body;
      const result = await adminAuthService.refreshToken(token);
      return successResponse(res, 200, "Cấp lại token thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async getMe(req, res, next) {
    try {
      const adminId = req.user.user_id;
      const result = await adminAuthService.getMe(adminId);
      return successResponse(
        res,
        200,
        "Lấy thông tin quản trị viên thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async logout(req, res, next) {
    try {
      const adminId = req.user.user_id;
      await adminAuthService.logout(adminId);
      return successResponse(res, 200, "Đăng xuất thành công");
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminAuthController;
