const express = require("express");
const router = express.Router();
const authController = require("./auth.controller");
const authMiddleware = require("../../../../../middlewares/auth.middleware");
const {
  loginLimiter,
} = require("../../../../../middlewares/ratelimit.middleware");

router.post(
  "/login",
  loginLimiter,
  authController.login,
);

router.post(
  "/logout",
  authMiddleware.verifyAccessToken,
  authController.logout,
);

router.post("/register", loginLimiter, authController.register);

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