const express = require("express");
const router = express.Router();
const walletController = require("./wallet.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");

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
  walletController.checkPin,
);
router.patch(
  "/balance",
  authMiddleware.verifyAccessToken,
  walletController.updateWalletBalance,
);
module.exports = router;
