const transactionController = require("./transaction.controller");
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../../middlewares/auth.middleware");
const idempotencyMiddleware = require("../../../../middlewares/idempotencyKey");
const {
  otpLimiter,
  sendOtpLimiter,
  transactionLimiter,
  exportLimiter,
} = require("../../../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../../../middlewares/riskGuard");

const sendOtpRisk = riskGuard({ challenge: 30, block: 55 });
const verifyOtpRisk = riskGuard({ challenge: 35, block: 60 });
const moneyRisk = riskGuard({ challenge: 35, block: 65 });

router.post(
  "/otp/send",
  authMiddleware.verifyAccessToken,
  sendOtpLimiter,
  sendOtpRisk,
  transactionController.sendTransactionOtp,
);

router.post(
  "/otp/resend",
  authMiddleware.verifyAccessToken,
  sendOtpLimiter,
  sendOtpRisk,
  transactionController.resendTransactionOtp,
);

router.post(
  "/otp/verify",
  authMiddleware.verifyAccessToken,
  otpLimiter,
  verifyOtpRisk,
  transactionController.verifyTransactionOtp,
);

router.get(
  "/receiver",
  authMiddleware.verifyAccessToken,
  transactionController.getReceiver,
);

router.post(
  "/transfer",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  moneyRisk,
  authMiddleware.verifyTransactionOtpToken("TRANSFER"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.transferMoney,
);

router.post(
  "/topup",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  moneyRisk,
  authMiddleware.verifyTransactionOtpToken("TOPUP"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.topupMoney,
);

router.post(
  "/withdraw",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  moneyRisk,
  authMiddleware.verifyTransactionOtpToken("WITHDRAW"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.withdrawMoney,
);

router.post(
  "/qr-payment",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  moneyRisk,
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.processQRPayment,
);

router.get(
  "/history",
  authMiddleware.verifyAccessToken,
  transactionController.getTransferHistory,
);

router.get(
  "/export",
  authMiddleware.verifyAccessToken,
  exportLimiter,
  transactionController.exportHistory,
);

router.get(
  "/history/:transactionId",
  authMiddleware.verifyAccessToken,
  transactionController.getTransactionDetail,
);

router.get(
  "/summary",
  authMiddleware.verifyAccessToken,
  transactionController.getCurrentMonthSummary,
);

router.get(
  "/stats",
  authMiddleware.verifyAccessToken,
  transactionController.getMerchantStats,
);
module.exports = router;