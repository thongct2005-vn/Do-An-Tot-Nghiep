const express = require("express");
const router = express.Router();
const merchantBankController = require("./bank.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");

router.get(
  "/status",
  authMiddleware.verifyAccessToken,
  merchantBankController.getBankLinkStatus,
);
router.post(
  "/link",
  authMiddleware.verifyAccessToken,
  authMiddleware.verifyTransactionOtpToken,
  merchantBankController.linkBankAccount,
);
module.exports = router;
