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
} = require("../../../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../../../middlewares/riskGuard");

const loginRisk = riskGuard({ challenge: 40, block: 70 });
const registerRisk = riskGuard({ challenge: 35, block: 60 });
const otpRisk = riskGuard({ challenge: 35, block: 60 });

router.post("/login", loginLimiter, loginRisk, merchantAuthController.login);
router.post(
  "/resend-login-otp",
  authMiddleware.verifyLoginOtpToken,
  sendOtpLimiter,
  otpRisk,
  merchantAuthController.resendLoginOtp,
);
router.post(
  "/verify-login-otp",
  authMiddleware.verifyLoginOtpToken,
  otpLimiter,
  otpRisk,
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
  loginLimiter,
  loginRisk,
  merchantAuthController.setupTotp,
);
router.post(
  "/totp/enable",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  otpLimiter,
  otpRisk,
  merchantAuthController.enableTotp,
);
router.post(
  "/totp/disable",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  otpLimiter,
  otpRisk,
  merchantAuthController.disableTotp,
);
router.post(
  "/register",
  registerLimiter,
  registerRisk,
  merchantAuthController.register,
);
router.post(
  "/verify-register",
  authMiddleware.verifyRegisterOtpToken,
  otpLimiter,
  otpRisk,
  merchantAuthController.verifyRegister,
);
router.post(
  "/refresh-token",
  authMiddleware.verifyRefreshTokenCookie,
  merchantAuthController.refreshToken,
);
module.exports = router;