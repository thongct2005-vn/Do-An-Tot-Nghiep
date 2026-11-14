const express = require("express");
const router = express.Router();
const bankController = require("./bank.controller");
const authMiddleware = require("../../middlewares/auth.middleware");

router.get(
  "/status",
  authMiddleware.verifyAccessToken,
  bankController.getBankLinkStatus,
);

router.post(
  "/link",
  authMiddleware.verifyAccessToken,
  authMiddleware.requirePinToken("BANK_LINK"),
  bankController.linkBankAccount,
);

router.patch(
  "/show-balance",
  authMiddleware.verifyAccessToken,
  authMiddleware.requirePinToken("BANK_SHOW_BALANCE"),
  bankController.enableShowBalance,
);

router.post(
  "/unlink",
  authMiddleware.verifyAccessToken,
  authMiddleware.requirePinToken("BANK_UNLINK"),
  bankController.unlinkBankAccount,
);

module.exports = router;