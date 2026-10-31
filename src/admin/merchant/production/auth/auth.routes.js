const express = require("express");
const router = express.Router();
const merchantAuthController = require("./auth.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");
const {
  loginLimiter,
  otpLimiter,
} = require("../../../../middlewares/ratelimit.middleware");

router.post("/login", loginLimiter, merchantAuthController.login);
router.post(
  "/resend-login-otp",
  otpLimiter,
  authMiddleware.verifyLoginOtpToken,
  merchantAuthController.resendLoginOtp,
);
router.post(
  "/verify-login-otp",
  otpLimiter,
  authMiddleware.verifyLoginOtpToken,
  merchantAuthController.verifyLoginOtp,
);
router.post(
  "/logout",
  authMiddleware.verifyAccessToken,
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
  loginLimiter,
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  merchantAuthController.setupTotp,
);
router.post(
  "/totp/enable",
  otpLimiter,
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  merchantAuthController.enableTotp,
);
router.post(
  "/totp/disable",
  otpLimiter,
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  merchantAuthController.disableTotp,
);
router.post("/register", loginLimiter, merchantAuthController.register);
router.post(
  "/verify-register",
  otpLimiter,
  authMiddleware.verifyRegisterOtpToken,
  merchantAuthController.verifyRegister,
);

router.post(
  "/refresh-token",
  authMiddleware.verifyRefreshTokenCookie,
  merchantAuthController.refreshToken,
);
module.exports = router;