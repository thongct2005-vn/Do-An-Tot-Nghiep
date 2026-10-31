const express = require("express");
const authMiddleware = require("../../../../middlewares/auth.middleware");

function createWalletRoutes(walletController) {
  const router = express.Router();
  router.post(
    "/check-transfer",
    authMiddleware.verifyAccessToken,
    walletController.checkTransferEligibility,
  );
  return router;
}

module.exports = createWalletRoutes;