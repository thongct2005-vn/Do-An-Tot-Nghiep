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
  sendOtpLimiter,
  riskGuard({ challenge: 30, block: 55 }),
  otpController.generateOtp,
);
router.post(
  "/verify-otp",
  otpLimiter,
  riskGuard({ challenge: 35, block: 60 }),
  otpController.verifyOtp,
);
module.exports = router;
