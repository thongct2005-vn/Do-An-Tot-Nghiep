const paymentRequestController = require("./paymentRequest.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const express = require("express");
const router = express.Router();

router.get(
  "/qr/static",
  authMiddleware.verifyAccessToken,
  paymentRequestController.createStaticQRToken,
);
router.get(
  "/qr/static/resolve",
  authMiddleware.verifyAccessToken,
  paymentRequestController.getUserAndWalletByStaticQRToken,
);

router.post(
  "/qr/dynamic",
  authMiddleware.verifyAccessToken,
  paymentRequestController.createDynamicQRToken,
);

router.get(
  "/qr/dynamic/resolve",
  authMiddleware.verifyAccessToken,
  paymentRequestController.getUserAndWalletByDynamicQRToken,
);
module.exports = router;
