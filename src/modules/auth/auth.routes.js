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

const loginRisk = riskGuard({ challenge: 40, block: 70 });
const registerRisk = riskGuard({ challenge: 35, block: 60 });
const otpRisk = riskGuard({ challenge: 35, block: 60 });

router.post("/login", loginLimiter, loginRisk, authController.login);
router.post(
  "/resend-login-otp",
  authMiddleware.verifyLoginOtpToken,
  sendOtpLimiter,
  otpRisk,
  authController.resendLoginOtp,
);
router.post(
  "/verify-login-otp",
  authMiddleware.verifyLoginOtpToken,
  otpLimiter,
  otpRisk,
  authController.verifyLoginOtp,
);
router.post(
  "/logout",
  authMiddleware.verifyAccessToken,
  logoutLimiter,
  authController.logout,
);

router.post("/totp/setup", loginLimiter, loginRisk, authController.setupTotp);
router.post(
  "/totp/recover",
  loginLimiter,
  loginRisk,
  authController.recoverTotp,
);
router.post(
  "/totp/enable",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("USER"),
  otpLimiter,
  otpRisk,
  authController.enableTotp,
);
router.post(
  "/totp/disable",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("USER"),
  otpLimiter,
  otpRisk,
  authController.disableTotp,
);
router.post("/register", registerLimiter, registerRisk, authController.register);
router.post(
  "/verify-register",
  authMiddleware.verifyRegisterOtpToken,
  otpLimiter,
  otpRisk,
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
