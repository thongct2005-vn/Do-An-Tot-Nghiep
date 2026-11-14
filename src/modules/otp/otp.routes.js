const express = require("express");
const router = express.Router();
const otpController = require("./otp.controller");
const {
  otpLimiter,
  sendOtpLimiter,
} = require("../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../middlewares/riskGuard");

router.post(
  "/send-otp",
  riskGuard("SEND_OTP"),
  sendOtpLimiter,
  otpController.generateOtp,
);
router.post(
  "/verify-otp",
  riskGuard("OTP"),
  otpLimiter,
  otpController.verifyOtp,
);
module.exports = router;
