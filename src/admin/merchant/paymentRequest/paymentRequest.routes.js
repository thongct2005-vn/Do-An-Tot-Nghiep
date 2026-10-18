const paymentMerchantRequestController = require("./paymentRequest.controller");
const authMiddleware = require("../../../middlewares/auth.middleware");
const express = require("express");
const router = express.Router();
router.post(
  "/payments",
  authMiddleware.verifyMerchant,
  paymentMerchantRequestController.createDynamicQRToken,
);
router.get(
  "/payments/:orderId",
  authMiddleware.verifyMerchant,
  paymentMerchantRequestController.findPaymentByOrderId,
);
module.exports = router;
