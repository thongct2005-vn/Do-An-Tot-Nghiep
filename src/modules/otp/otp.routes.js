const express = require('express');
const router = express.Router();
const otpController = require('./otp.controller');

router.post('/send-otp', otpController.generateOtp);
router.post('/verify-otp', otpController.verifyOtp);
module.exports = router;
