const express = require("express");
const router = express.Router();
const merchantAuthController = require("./auth.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");
const {
  loginLimiter,
  registerLimiter,
  logoutLimiter,
  otpLimiter,
  sendOtpLimiter,
  forgotRequestLimiter,
  resetCredentialLimiter,
} = require("../../../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../../../middlewares/riskGuard");
const { RISK_THRESHOLDS } = require("../../../../config/limits");

const loginRisk = riskGuard(RISK_THRESHOLDS.LOGIN);
const registerRisk = riskGuard(RISK_THRESHOLDS.REGISTER);
const otpRisk = riskGuard(RISK_THRESHOLDS.OTP);
const forgotRisk = riskGuard(RISK_THRESHOLDS.FORGOT);

router.post("/login", loginRisk, loginLimiter, merchantAuthController.login);
router.post(
  "/resend-login-otp",
  authMiddleware.verifyLoginOtpToken,
  otpRisk,
  sendOtpLimiter,
  merchantAuthController.resendLoginOtp,
);
router.post(
  "/verify-login-otp",
  authMiddleware.verifyLoginOtpToken,
  otpRisk,
  otpLimiter,
  merchantAuthController.verifyLoginOtp,
);
router.post(
  "/logout",
  authMiddleware.verifyAccessToken,
  logoutLimiter,
  merchantAuthController.logout,
);
router.get(
  "/totp/status",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  merchantAuthController.getTotpStatus,
);
router.post(
  "/totp/setup",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  loginRisk,
  loginLimiter,
  merchantAuthController.setupTotp,
);
router.post(
  "/totp/enable",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  otpRisk,
  otpLimiter,
  merchantAuthController.enableTotp,
);
router.post(
  "/totp/disable",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  otpRisk,
  otpLimiter,
  merchantAuthController.disableTotp,
);
router.post(
  "/register",
  registerRisk,
  registerLimiter,
  merchantAuthController.register,
);
router.post(
  "/verify-register",
  authMiddleware.verifyRegisterOtpToken,
  otpRisk,
  otpLimiter,
  merchantAuthController.verifyRegister,
);
router.post(
  "/refresh-token",
  authMiddleware.verifyRefreshTokenCookie,
  merchantAuthController.refreshToken,
);
router.post(
  "/forgot/request",
  forgotRisk,
  forgotRequestLimiter,
  merchantAuthController.forgotRequest,
);
router.post(
  "/forgot/resend-otp",
  authMiddleware.verifyMerchantForgotOtpToken,
  forgotRisk,
  sendOtpLimiter,
  merchantAuthController.forgotResendOtp,
);
router.post(
  "/forgot/verify",
  authMiddleware.verifyMerchantForgotOtpToken,
  forgotRisk,
  otpLimiter,
  merchantAuthController.forgotVerify,
);
router.patch(
  "/forgot/reset-password",
  authMiddleware.verifyMerchantForgotResetTokens,
  resetCredentialLimiter,
  merchantAuthController.forgotResetPassword,
);
router.post(
  "/change-password/request",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  sendOtpLimiter,
  merchantAuthController.changePasswordRequest,
);
router.post(
  "/change-password/resend-otp",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  authMiddleware.verifyMerchantChangePasswordOtpToken,
  sendOtpLimiter,
  merchantAuthController.changePasswordResendOtp,
);
router.post(
  "/change-password/verify",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  authMiddleware.verifyMerchantChangePasswordOtpToken,
  otpRisk,
  otpLimiter,
  merchantAuthController.changePasswordVerify,
);
router.patch(
  "/change-password",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  authMiddleware.verifyMerchantChangePasswordVerifiedToken,
  resetCredentialLimiter,
  merchantAuthController.changePasswordReset,
);
module.exports = router;