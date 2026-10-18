const express = require("express");
const router = express.Router();
const otpController = require("./otp.controller");
const {
  otpLimiter,
  sendOtpLimiter,
} = require("../../middlewares/ratelimit.middleware");

router.post("/send-otp", sendOtpLimiter, otpController.generateOtp);
router.post("/verify-otp", otpLimiter, otpController.verifyOtp);
module.exports = router;
