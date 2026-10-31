const express = require("express");
const router = express.Router();
const dashboardController = require("./dashboard.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");
const { resetApiKey, resetSecretKey } = require("../../../../middlewares/ratelimit.middleware");
router.get(
  "/info",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  dashboardController.getMerchantInfoById,
);
router.patch(
  "/callback",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  dashboardController.updateCallBackUrl,
);

router.post(
  "/reset-apikey",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  resetApiKey,
  dashboardController.resetApiKey,
);

router.post(
  "/reset-secretkey",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  resetSecretKey,
  dashboardController.resetSecretKey,
);
module.exports = router;
