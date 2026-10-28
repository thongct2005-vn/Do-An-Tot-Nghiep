const transactionController = require("./transaction.controller");
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../../middlewares/auth.middleware");
const idempotencyMiddleware = require("../../../../middlewares/idempotencyKey");
const {
  otpLimiter,
  sendOtpLimiter,
  transactionLimiter,
} = require("../../../../middlewares/ratelimit.middleware");

router.post(
  "/otp/send",
  sendOtpLimiter,
  authMiddleware.verifyAccessToken,
  transactionController.sendTransactionOtp,
);

router.post(
  "/otp/resend",
  sendOtpLimiter,
  authMiddleware.verifyAccessToken,
  transactionController.resendTransactionOtp,
);

router.post(
  "/otp/verify",
  otpLimiter,
  authMiddleware.verifyAccessToken,
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
  authMiddleware.verifyTransactionOtpToken("TRANSFER"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.transferMoney,
);

router.post(
  "/topup",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  authMiddleware.verifyTransactionOtpToken("TOPUP"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.topupMoney,
);

router.post(
  "/withdraw",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  authMiddleware.verifyTransactionOtpToken("WITHDRAW"),
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.withdrawnMoney,
);

router.post(
  "/qr-payment",
  authMiddleware.verifyAccessToken,
  transactionLimiter,
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.processQRPayment,
);

router.get(
  "/history",
  authMiddleware.verifyAccessToken,
  transactionController.getTransferHistory,
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