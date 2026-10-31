const authMiddleware = require("../../../../middlewares/auth.middleware");
const idempotencyKey = require("../../../../middlewares/idempotencyKey");
const express = require("express");

function createPaymentRequestRoutes(paymentMerchantRequestController) {
  const router = express.Router();
  router.post(
    "/payments",
    authMiddleware.verifyMerchant,
    idempotencyKey.checkIdempotencyKey,
    paymentMerchantRequestController.createDynamicQRToken,
  );
  router.get(
    "/payments/:orderId",
    authMiddleware.verifyMerchant,
    paymentMerchantRequestController.findPaymentByOrderId,
  );
  return router;
}

module.exports = createPaymentRequestRoutes;
