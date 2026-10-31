const express = require("express");
const router = express.Router();
const merchantAuthController = require("./auth.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");
const {
  loginLimiter,
} = require("../../../../middlewares/ratelimit.middleware");

router.post("/login", loginLimiter, merchantAuthController.login);
router.post(
  "/logout",
  authMiddleware.verifyAccessToken,
  merchantAuthController.logout,
);
router.post("/register", loginLimiter, merchantAuthController.register);
router.post(
  "/refresh-token",
  authMiddleware.verifySandboxRefreshTokenCookie,
  merchantAuthController.refreshToken,
);
module.exports = router;