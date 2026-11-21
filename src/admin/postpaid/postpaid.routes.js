const express = require("express");
const authMiddleware = require("../../middlewares/auth.middleware");
const requireCurrentAdminSession = require("../auth/adminSession.middleware");
const adminPostpaidController = require("./postpaid.controller");

const router = express.Router();

router.use(authMiddleware.verifyAccessToken);
router.use(authMiddleware.requireRole("ADMIN"));
router.use(requireCurrentAdminSession);

router.get("/overview", adminPostpaidController.getOverview);
router.get("/wallets", adminPostpaidController.listWallets);
router.get("/wallets/:userId", adminPostpaidController.getWalletDetail);
router.post("/wallets/:userId/freeze", adminPostpaidController.freezeWallet);
router.post("/wallets/:userId/unfreeze", adminPostpaidController.unfreezeWallet);
router.post("/wallets/:userId/limit-adjust", adminPostpaidController.adjustCreditLimit);

router.get("/entries", adminPostpaidController.listEntries);

router.get("/unlock-requests", adminPostpaidController.listUnlockRequests);
router.get("/unlock-requests/:id/proof/:index", adminPostpaidController.getUnlockProofImage);
router.post("/unlock-requests/:id/approve", adminPostpaidController.approveUnlockRequest);
router.post("/unlock-requests/:id/reject", adminPostpaidController.rejectUnlockRequest);

module.exports = router;
