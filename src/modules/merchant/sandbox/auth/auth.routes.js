const express = require("express");
const router = express.Router();
const merchantAuthController = require("./auth.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");
const {
  loginLimiter,
  registerLimiter,
  logoutLimiter,
  resetCredentialLimiter,
} = require("../../../../middlewares/ratelimit.middleware");

router.post("/login", loginLimiter, merchantAuthController.login);
router.post(
  "/logout",
  authMiddleware.verifyAccessToken,
  logoutLimiter,
  merchantAuthController.logout,
);
router.post("/register", registerLimiter, merchantAuthController.register);
router.post(
  "/refresh-token",
  authMiddleware.verifySandboxRefreshTokenCookie,
  merchantAuthController.refreshToken,
);
router.patch(
  "/first-login/change-password",
  authMiddleware.verifyMerchantFirstLoginChangeToken,
  resetCredentialLimiter,
  merchantAuthController.firstLoginChangePassword,
);
module.exports = router;