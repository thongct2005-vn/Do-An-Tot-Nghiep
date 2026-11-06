const express = require("express");
const router = express.Router();
const userController = require("./user.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const {
  contactCheckLimiter,
  findUserLimiter,
  contactDailyQuota,
  otpLimiter,
  sendOtpLimiter,
  forgotRequestLimiter,
  forgotKycLimiter,
  resetCredentialLimiter,
} = require("../../middlewares/ratelimit.middleware");
const { uploadKycImages } = require("../../middlewares/upload.middleware");
const { riskGuard } = require("../../middlewares/riskGuard");

const forgotRisk = riskGuard({ challenge: 35, block: 60 });

router.get(
  "/find-user",
  authMiddleware.verifyAccessToken,
  findUserLimiter,
  userController.findUserByPhone,
);
router.post(
  "/check-contact",
  authMiddleware.verifyAccessToken,
  contactCheckLimiter,
  contactDailyQuota,
  userController.findUserByPhoneHashList,
);

router.get(
  "/pin-status",
  authMiddleware.verifyAccessToken,
  userController.checkPinStatus,
);

router.post(
  "/create-pin",
  authMiddleware.verifyAccessToken,
  userController.createPin,
);

router.patch(
  "/fcm-token",
  authMiddleware.verifyAccessToken,
  userController.updateFcmToken,
);

router.get(
  "/fcm-token",
  authMiddleware.verifyAccessToken,
  userController.getFcmToken,
);


router.post(
  "/forgot/request",
  forgotRequestLimiter,
  forgotRisk,
  userController.forgotRequest,
);

router.post(
  "/forgot/resend-otp",
  authMiddleware.verifyForgotOtpToken,
  sendOtpLimiter,
  forgotRisk,
  userController.forgotResendOtp,
);

router.post(
  "/forgot/verify-otp",
  authMiddleware.verifyForgotOtpToken,
  otpLimiter,
  forgotRisk,
  userController.forgotVerifyOtp,
);

router.post(
  "/forgot/kyc",
  authMiddleware.verifyForgotKycToken,
  forgotKycLimiter,
  uploadKycImages,
  userController.forgotVerifyKyc,
);

router.patch(
  "/reset-pin",
  authMiddleware.verifyResetToken("reset_pin"),
  resetCredentialLimiter,
  userController.resetPin,
);

router.patch(
  "/reset-password",
  authMiddleware.verifyResetToken("reset_password"),
  resetCredentialLimiter,
  userController.resetPassword,
);
module.exports = router;