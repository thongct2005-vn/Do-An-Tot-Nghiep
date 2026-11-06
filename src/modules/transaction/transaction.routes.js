const transactionController = require("./transaction.controller");
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/auth.middleware");
const idempotencyMiddleware = require("../../middlewares/idempotencyKey");
const {
  transactionLimiter,
  exportLimiter,
} = require("../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../middlewares/riskGuard");

const moneyRisk = riskGuard({ challenge: 35, block: 65 });

router.post(
  "/transfer",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  moneyRisk,
  authMiddleware.requirePinToken("TRANSFER"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.transferMoney,
);

router.post(
  "/topup",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  moneyRisk,
  authMiddleware.requirePinToken("TOPUP"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.topupMoney,
);

router.post(
  "/withdraw",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  moneyRisk,
  authMiddleware.requirePinToken("WITHDRAW"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.withdrawMoney,
);

router.post(
  "/qr-payment",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  moneyRisk,
  authMiddleware.requirePinToken("QR_PAYMENT"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.processQRPayment,
);

router.get(
  "/history",
  authMiddleware.verifyAccessToken,
  transactionController.getTransferHistory,
);

router.post(
  "/export-email",
  authMiddleware.verifyAccessToken,
  exportLimiter,
  transactionController.exportHistoryToEmail,
);

router.get(
  "/summary",
  authMiddleware.verifyAccessToken,
  transactionController.getCurrentMonthSummary,
);

module.exports = router;