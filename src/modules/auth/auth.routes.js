const express = require("express");
const router = express.Router();
const authController = require("./auth.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const {
  loginLimiter,
  otpLimiter,
} = require("../../middlewares/ratelimit.middleware");

router.post("/login", loginLimiter, authController.login);
router.post(
  "/resend-login-otp",
  otpLimiter,
  authMiddleware.verifyLoginOtpToken,
  authController.resendLoginOtp,
);
router.post(
  "/verify-login-otp",
  otpLimiter,
  authMiddleware.verifyLoginOtpToken,
  authController.verifyLoginOtp,
);
router.post("/logout", authMiddleware.verifyAccessToken, authController.logout);

router.post("/totp/setup", loginLimiter, authController.setupTotp);
router.post("/totp/recover", loginLimiter, authController.recoverTotp);
router.post(
  "/totp/enable",
  otpLimiter,
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("USER"),
  authController.enableTotp,
);
router.post(
  "/totp/disable",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("USER"),
  authController.disableTotp,
);
router.post("/register", loginLimiter, authController.register);
router.post(
  "/verify-register",
  otpLimiter,
  authMiddleware.verifyRegisterOtpToken,
  authController.verifyRegister,
);
router.post("/checkPhoneExists", loginLimiter, authController.isPhoneExist);
router.post("/checkEmailExists", loginLimiter, authController.isEmailExist);
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