const express = require("express");
const router = express.Router();
const merchantWalletController = require("./wallet.controller");
const authMiddleware = require("../../../../middlewares/auth.middleware");

router.get(
  "/balance",
  authMiddleware.verifyAccessToken,
  merchantWalletController.getWalletByUserId,
);
router.post(
  "/check-transfer",
  authMiddleware.verifyAccessToken,
  merchantWalletController.checkTransferEligibility,
);
router.post(
  "/check-pin",
  authMiddleware.verifyAccessToken,
  merchantWalletController.checkPin,
);

module.exports = router;
