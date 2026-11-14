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

const sendOtpRisk = riskGuard("SEND_OTP");
const verifyOtpRisk = riskGuard("OTP");
const moneyRisk = riskGuard("TRANSACTION");

router.post(
  "/otp/send",
  authMiddleware.verifyAccessToken,
  sendOtpRisk,
  sendOtpLimiter,
  transactionController.sendTransactionOtp,
);

router.post(
  "/otp/resend",
  authMiddleware.verifyAccessToken,
  sendOtpRisk,
  sendOtpLimiter,
  transactionController.resendTransactionOtp,
);

router.post(
  "/otp/verify",
  authMiddleware.verifyAccessToken,
  verifyOtpRisk,
  otpLimiter,
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
  moneyRisk,
  transactionLimiter,
  authMiddleware.verifyTransactionOtpToken("TRANSFER"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.transferMoney,
);

router.post(
  "/topup",
  authMiddleware.verifyAccessToken,
  moneyRisk,
  transactionLimiter,
  authMiddleware.verifyTransactionOtpToken("TOPUP"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.topupMoney,
);

router.post(
  "/withdraw",
  authMiddleware.verifyAccessToken,
  moneyRisk,
  transactionLimiter,
  authMiddleware.verifyTransactionOtpToken("WITHDRAW"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.withdrawMoney,
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

router.get(
  "/stats/export",
  authMiddleware.verifyAccessToken,
  exportLimiter,
  transactionController.exportMerchantStats,
);

router.get(
  "/limits",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  transactionController.getTransactionLimits,
);
module.exports = router;