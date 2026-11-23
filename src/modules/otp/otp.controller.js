// otp.controller.js: Controller xử lý HTTP gửi và xác thực mã OTP email.
const otpService = require("./otp.service");
const { successResponse } = require("../../utils/common/http");

const otpController = {
  async generateOtp(req, res, next) {
    try {
      const { email } = req.body;
      const result = await otpService.generateAndSaveOtp({ email });
      return successResponse(res, 200, "Gửi mã OTP thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async verifyOtp(req, res, next) {
    try {
      const { email, otp } = req.body;
      const result = await otpService.verifyOtp({ email, otp });
      return successResponse(res, 200, "Xác thực OTP thành công", result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = otpController;
