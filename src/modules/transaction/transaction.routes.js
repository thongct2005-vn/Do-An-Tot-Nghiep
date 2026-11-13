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
const { RISK_THRESHOLDS } = require("../../config/limits");

const moneyRisk = riskGuard(RISK_THRESHOLDS.TRANSACTION);

router.post(
  "/transfer",
  authMiddleware.verifyAccessToken,
  moneyRisk,
  transactionLimiter,
  authMiddleware.requirePinToken("TRANSFER"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.transferMoney,
);

router.post(
  "/topup",
  authMiddleware.verifyAccessToken,
  moneyRisk,
  transactionLimiter,
  authMiddleware.requirePinToken("TOPUP"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.topupMoney,
);

router.post(
  "/withdraw",
  authMiddleware.verifyAccessToken,
  moneyRisk,
  transactionLimiter,
  authMiddleware.requirePinToken("WITHDRAW"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.withdrawMoney,
);

router.post(
  "/qr-payment",
  authMiddleware.verifyAccessToken,
  moneyRisk,
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

router.post(
  "/preview-fee",
  authMiddleware.verifyAccessToken,
  transactionController.previewFee,
);

router.get(
  "/limits",
  authMiddleware.verifyAccessToken,
  transactionController.getTransactionLimits,
);

module.exports = router;