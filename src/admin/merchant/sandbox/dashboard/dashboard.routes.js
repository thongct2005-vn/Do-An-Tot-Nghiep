const express = require("express");
const router = express.Router();
const dashboardController = require("./dashboard.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");
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
module.exports = router;
