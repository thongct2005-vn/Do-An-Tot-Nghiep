const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/auth.middleware");
const idempotencyMiddleware = require("../../middlewares/idempotencyKey");
const { transactionLimiter } = require("../../middlewares/ratelimit.middleware");
const { riskGuard } = require("../../middlewares/riskGuard");
const postpaidController = require("./postpaid.controller");

const moneyRisk = riskGuard("TRANSACTION");

router.get("/info", authMiddleware.verifyAccessToken, postpaidController.getInfo);
router.get("/wallet", authMiddleware.verifyAccessToken, postpaidController.getWallet);
router.post("/activate", authMiddleware.verifyAccessToken, postpaidController.activate);
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

module.exports = router;

