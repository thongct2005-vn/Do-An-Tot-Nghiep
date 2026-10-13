const express = require("express");
const router = express.Router();
const merchantAuthController = require("./auth.controller");
const authMiddleware = require("../../../middlewares/auth.middleware");
const {
  loginLimiter,
  otpLimiter,
} = require("../../../middlewares/ratelimit.middleware");

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
router.post("/register", loginLimiter, merchantAuthController.register);
router.post(
  "/verify-register",
  otpLimiter,
  authMiddleware.verifyRegisterOtpToken,
  merchantAuthController.verifyRegister,
);
router.post(
  "/checkPhoneExists",
  loginLimiter,
  merchantAuthController.isPhoneExist,
);
router.post(
  "/checkEmailExists",
  loginLimiter,
  merchantAuthController.isEmailExist,
);
router.get(
  "/me",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  merchantAuthController.getMe,
);
router.post(
  "/refresh-token",
  authMiddleware.verifyRefreshToken,
  merchantAuthController.refreshToken,
);
module.exports = router;