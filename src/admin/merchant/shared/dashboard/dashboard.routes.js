const express = require("express");
const authMiddleware = require("../../../../middlewares/auth.middleware");
const { resetApiKey, resetSecretKey } = require("../../../../middlewares/ratelimit.middleware");
function createDashboardRoutes(dashboardController) {
  const router = express.Router();
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
  return router;
}

module.exports = createDashboardRoutes;