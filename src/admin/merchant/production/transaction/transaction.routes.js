const transactionController = require("./transaction.controller");
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../../middlewares/auth.middleware");
const idempotencyMiddleware = require("../../../../middlewares/idempotencyKey");
const { otpLimiter } = require("../../../../middlewares/ratelimit.middleware");

router.post(
  "/otp/send",
  otpLimiter,
  authMiddleware.verifyAccessToken,
  transactionController.sendTransactionOtp,
);

router.post(
  "/otp/resend",
  otpLimiter,
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
  authMiddleware.verifyTransactionOtpToken,
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.transferMoney,
);

router.post(
  "/topup",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyTransactionOtpToken,
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.topupMoney,
);

router.post(
  "/withdraw",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyTransactionOtpToken,
  idempotencyMiddleware.checkIdempotencyKey,
  transactionController.withdrawnMoney,
);

router.post(
  "/qr-payment",
  authMiddleware.verifyAccessToken,
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