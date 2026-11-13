const productController = require("./product.controller");
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../../middlewares/auth.middleware");
const { exportLimiter } = require("../../../../middlewares/ratelimit.middleware");

router.get(
  "/top-selling",
  authMiddleware.verifyAccessToken,
  productController.getTopSellingProducts
);

router.get(
  "/top-selling/export",
  authMiddleware.verifyAccessToken,
  exportLimiter,
  productController.exportTopSellingProducts
);

module.exports = router;