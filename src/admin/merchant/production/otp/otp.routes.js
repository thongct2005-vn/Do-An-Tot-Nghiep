const express = require("express");
const router = express.Router();
const merchantOtpController = require("./otp.controller");
const {
  otpLimiter,
  sendOtpLimiter,
} = require("../../../../middlewares/ratelimit.middleware");

router.post("/send-otp", sendOtpLimiter, merchantOtpController.generateOtp);
router.post("/verify-otp", otpLimiter, merchantOtpController.verifyOtp);
module.exports = router;
