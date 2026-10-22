const merchantOtpService = require("./otp.service");
const { successResponse } = require("../../../../utils/apiResponse");

const merchantOtpController = {
  async generateOtp(req, res, next) {
    try {
      const { email, phone } = req.body;
      const result = await merchantOtpService.generateAndSaveOtp({ email, phone });
      return successResponse(res, 200, "Gửi mã OTP thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async verifyOtp(req, res, next) {
    try {
      const { email, otp } = req.body;
      const result = await merchantOtpService.verifyOtp({ email, otp });
      return successResponse(res, 200, "Xác thực OTP thành công", result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = merchantOtpController;
