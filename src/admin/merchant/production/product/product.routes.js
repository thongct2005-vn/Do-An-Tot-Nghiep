const productController = require("./product.controller");
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../../middlewares/auth.middleware");
router.get(
  "/top-selling",
  authMiddleware.verifyAccessToken,
  productController.getTopSellingProducts
);

module.exports = router;