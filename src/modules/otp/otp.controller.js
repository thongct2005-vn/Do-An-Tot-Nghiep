const { sendOtp } = require("../../services/twilio.service");
const { successResponse } = require("../../utils/apiResponse");
const otpService = require("./otp.service");

const otpController = {
    async sendOtpByEmail(req, res, next) {
    try {
      const { email } = req.body;
      const result = await otpService.generateAndSaveOtp({email});
      return successResponse(res, 200, "Gửi OTP thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async verifyOtpByEmail(req, res, next) {
    try {
        const{phone, code} = req.body;
        const result = await otpService.verifyOtpByTwilio({phone, code});
        return successResponse(res, 200, "OTP chính xác", result);
    } catch (e) {
      next(e);
    }
  },


  async sendOtpByTwilio(req, res, next) {
    try {
      const { phone } = req.body;
      const result = await otpService.sendOtpByTwilio({phone});
      return successResponse(res, 200, "Gửi OTP thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async verifyOtpByTwilio(req, res, next) {
    try {
        const{phone, code} = req.body;
        console.log(req.body);
        const result = await otpService.verifyOtpByTwilio({phone, code});
        return successResponse(res, 200, "OTP chính xác", result);
    } catch (e) {
      next(e);
    }
  },
};
module.exports = otpController;