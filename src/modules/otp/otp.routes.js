const express = require("express");
const router = express.Router();
const otpController = require("./otp.controller");

router.post("/send-otp", otpController.sendOtpByTwilio);
router.post("/verify-otp", otpController.verifyOtpByTwilio);
module.exports = router;
