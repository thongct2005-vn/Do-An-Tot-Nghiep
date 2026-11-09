const express = require("express");
const router = express.Router();
const adminAuthController = require("./auth.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const requireCurrentAdminSession = require("./adminSession.middleware");
const { loginLimiter } = require("../../middlewares/ratelimit.middleware");

router.post("/login", loginLimiter, adminAuthController.login);
router.post(
  "/refresh-token",
  authMiddleware.verifyRefreshToken,
  adminAuthController.refreshToken,
);
router.get(
  "/me",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("ADMIN"),
  requireCurrentAdminSession,
  adminAuthController.getMe,
);
router.post(
  "/logout",
  authMiddleware.verifyRefreshToken,
  authMiddleware.requireRole("ADMIN"),
  adminAuthController.logout,
);

module.exports = router;
