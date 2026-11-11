const express = require("express");
const router = express.Router();
const otpController = require("./otp.controller");
const {
  otpLimiter,
  sendOtpLimiter,
} = require("../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../middlewares/riskGuard");
const { RISK_THRESHOLDS } = require("../../config/limits");

router.post(
  "/send-otp",
  riskGuard(RISK_THRESHOLDS.SEND_OTP),
  sendOtpLimiter,
  otpController.generateOtp,
);
router.post(
  "/verify-otp",
  riskGuard(RISK_THRESHOLDS.OTP),
  otpLimiter,
  otpController.verifyOtp,
);
module.exports = router;
