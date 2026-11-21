const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/auth.middleware");
const idempotencyMiddleware = require("../../middlewares/idempotencyKey");
const { transactionLimiter } = require("../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../middlewares/riskGuard");
const { uploadPostpaidProofImages } = require("../../middlewares/upload.middleware");
const postpaidController = require("./postpaid.controller");

const moneyRisk = riskGuard("TRANSACTION");

router.get("/info", authMiddleware.verifyAccessToken, postpaidController.getInfo);
router.get("/wallet", authMiddleware.verifyAccessToken, postpaidController.getWallet);
router.post(
  "/activate",
  authMiddleware.verifyAccessToken,
  authMiddleware.requirePinToken("POSTPAID_ACTIVATE"),
  postpaidController.activate,
);
router.post(
  "/freeze",
  authMiddleware.verifyAccessToken,
  authMiddleware.requirePinToken("POSTPAID_FREEZE"),
  postpaidController.freeze,
);
router.post(
  "/unfreeze",
  authMiddleware.verifyAccessToken,
  authMiddleware.requirePinToken("POSTPAID_UNFREEZE"),
  postpaidController.unfreeze,
);
router.post(
  "/close",
  authMiddleware.verifyAccessToken,
  authMiddleware.requirePinToken("POSTPAID_CLOSE"),
  postpaidController.close,
);
router.get("/entries", authMiddleware.verifyAccessToken, postpaidController.getEntries);

router.post(
  "/repay",
  authMiddleware.verifyAccessToken,
  moneyRisk,
  transactionLimiter,
  authMiddleware.requirePinToken("POSTPAID_REPAY"),
  idempotencyMiddleware.checkIdempotencyKey,
  postpaidController.repay,
);

router.post(
  "/unlock-requests",
  authMiddleware.verifyAccessToken,
  uploadPostpaidProofImages,
  postpaidController.submitUnlockRequest,
);

router.get(
  "/unlock-requests/latest",
  authMiddleware.verifyAccessToken,
  postpaidController.getLatestUnlockRequest,
);

module.exports = router;

