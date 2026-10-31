const express = require("express");
const router = express.Router();
const merchantBankController = require("./bank.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");
const idempotencyMiddleware = require("../../../../middlewares/idempotencyKey");

router.get(
  "/status",
  authMiddleware.verifyAccessToken,
  merchantBankController.getBankLinkStatus,
);
router.get(
  "/balance/:linkedBankAccountId",
  authMiddleware.verifyAccessToken,
  merchantBankController.getLinkedAccountBalance,
);
router.post(
  "/link",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyTransactionOtpToken,
  idempotencyMiddleware.checkIdempotencyKey,
  merchantBankController.linkBankAccount,
);
module.exports = router;