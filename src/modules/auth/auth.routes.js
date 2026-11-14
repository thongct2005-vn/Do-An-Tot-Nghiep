const express = require("express");
const router = express.Router();
const authController = require("./auth.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const {
  loginLimiter,
  registerLimiter,
  lookupLimiter,
  logoutLimiter,
  otpLimiter,
  sendOtpLimiter,
} = require("../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../middlewares/riskGuard");

const loginRisk = riskGuard("LOGIN");
const registerRisk = riskGuard("REGISTER");
const otpRisk = riskGuard("OTP");

router.post("/login", loginRisk, loginLimiter, authController.login);
router.post(
  "/resend-login-otp",
  authMiddleware.verifyLoginOtpToken,
  otpRisk,
  sendOtpLimiter,
  authController.resendLoginOtp,
);
router.post(
  "/verify-login-otp",
  authMiddleware.verifyLoginOtpToken,
  otpRisk,
  otpLimiter,
  authController.verifyLoginOtp,
);
router.post(
  "/logout",
  authMiddleware.verifyAccessToken,
  logoutLimiter,
  authController.logout,
);

router.post("/totp/setup", loginRisk, loginLimiter, authController.setupTotp);
router.post(
  "/totp/recover",
  loginRisk,
  loginLimiter,
  authController.recoverTotp,
);
router.post(
  "/totp/enable",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("USER"),
  otpRisk,
  otpLimiter,
  authController.enableTotp,
);
router.post(
  "/totp/disable",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("USER"),
  otpRisk,
  otpLimiter,
  authController.disableTotp,
);
router.post("/register", registerRisk, registerLimiter, authController.register);
router.post(
  "/verify-register",
  authMiddleware.verifyRegisterOtpToken,
  otpRisk,
  otpLimiter,
  authController.verifyRegister,
);
router.post("/checkPhoneExists", lookupLimiter, authController.isPhoneExist);
router.post("/checkEmailExists", lookupLimiter, authController.isEmailExist);
router.get(
  "/me",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("USER"),
  authController.getMe,
);
router.post(
  "/refresh-token",
  authMiddleware.verifyRefreshToken,
  authController.refreshToken,
);
module.exports = router;
