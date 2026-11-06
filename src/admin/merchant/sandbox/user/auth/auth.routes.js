const express = require("express");
const router = express.Router();
const authController = require("./auth.controller");
const authMiddleware = require("../../../../../middlewares/auth.middleware");
const {
  loginLimiter,
  registerLimiter,
  lookupLimiter,
  logoutLimiter,
} = require("../../../../../middlewares/ratelimit.middleware");

router.post(
  "/login",
  loginLimiter,
  authController.login,
);

router.post(
  "/logout",
  authMiddleware.verifyAccessToken,
  logoutLimiter,
  authController.logout,
);

router.post("/register", registerLimiter, authController.register);

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