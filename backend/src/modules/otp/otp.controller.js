const otpService = require("./otp.service");
const { successResponse } = require("../../utils/apiResponse");

const otpController = {
  async generateOtp(req, res, next) {
    try {
      const { email, phone } = req.body;
      const result = await otpService.generateAndSaveOtp({ email, phone });
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
