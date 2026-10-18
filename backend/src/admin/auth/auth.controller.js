const { successResponse } = require("../../utils/apiResponse");
const adminAuthService = require("./auth.service");

const adminAuthController = {
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const result = await adminAuthService.login({ email, password });
      return successResponse(res, 200, "Đăng nhập Admin thành công", result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminAuthController;
