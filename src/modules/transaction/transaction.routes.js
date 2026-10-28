const transactionController = require("./transaction.controller");
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/auth.middleware");
const idempotencyMiddleware = require("../../middlewares/idempotencyKey");
const { transactionLimiter } = require("../../middlewares/ratelimit.middleware");

router.post(
  "/transfer",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  authMiddleware.requirePinToken("TRANSFER"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.transferMoney,
);

router.post(
  "/topup",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  authMiddleware.requirePinToken("TOPUP"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.topupMoney,
);

router.post(
  "/withdraw",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  authMiddleware.requirePinToken("WITHDRAW"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.withdrawnMoney,
);

router.post(
  "/qr-payment",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  authMiddleware.requirePinToken("QR_PAYMENT"),
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