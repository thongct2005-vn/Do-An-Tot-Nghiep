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
  authMiddleware.verifyTransactionOtpToken("BANK_LINK"),
  idempotencyMiddleware.checkIdempotencyKey,
  merchantBankController.linkBankAccount,
);
router.patch(
  "/show-balance",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyTransactionOtpToken("BANK_SHOW_BALANCE"),
  merchantBankController.enableShowBalance,
);
router.post(
  "/unlink",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyTransactionOtpToken("BANK_UNLINK"),
  idempotencyMiddleware.checkIdempotencyKey,
  merchantBankController.unlinkBankAccount,
);
module.exports = router;