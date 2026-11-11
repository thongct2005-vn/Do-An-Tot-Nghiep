const express = require("express");
const router = express.Router();
const walletController = require("./wallet.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const {
  pinCheckLimiter,
  otpLimiter,
  sendOtpLimiter,
} = require("../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../middlewares/riskGuard");
const { RISK_THRESHOLDS } = require("../../config/limits");

const moneyRisk = riskGuard(RISK_THRESHOLDS.TRANSACTION);
const otpRisk = riskGuard(RISK_THRESHOLDS.OTP);

router.get(
  "/balance",
  authMiddleware.verifyAccessToken,
  walletController.getWalletByUserId,
);
router.post(
  "/check-transfer",
  authMiddleware.verifyAccessToken,
  walletController.checkTransferEligibility,
);
router.post(
  "/check-pin",
  authMiddleware.verifyAccessToken,
  moneyRisk,
  pinCheckLimiter,
  walletController.checkPin,
);
router.post(
  "/verify-pin-challenge",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyPinChallengeToken,
  otpRisk,
  otpLimiter,
  walletController.verifyPinChallenge,
);
router.post(
  "/resend-pin-challenge",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyPinChallengeToken,
  otpRisk,
  sendOtpLimiter,
  walletController.resendPinChallenge,
);

module.exports = router;