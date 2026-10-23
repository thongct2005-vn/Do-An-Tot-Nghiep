const transactionController = require("./transaction.controller");
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/auth.middleware");
const idempotencyMiddleware = require("../../middlewares/idempotencyKey");

router.post(
  "/transfer",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyPinToken,
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.transferMoney,
);

router.post(
  "/topup",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyPinToken,
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.topupMoney,
);

router.post(
  "/withdraw",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyPinToken,
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.withdrawnMoney,
);

router.post(
  "/qr-payment",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyPinToken,
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.processQRPayment,
);

router.get(
  "/history",
  authMiddleware.verifyAccessToken,
  transactionController.getTransferHistory,
);

router.get(
  "/summary",
  authMiddleware.verifyAccessToken,
  transactionController.getCurrentMonthSummary,
);

module.exports = router;