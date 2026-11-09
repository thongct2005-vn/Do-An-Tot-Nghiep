const express = require("express");
const router = express.Router();
const adminTransactionController = require("./transaction.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const requireCurrentAdminSession = require("../auth/adminSession.middleware");

router.use(authMiddleware.verifyAccessToken);
router.use(authMiddleware.requireRole("ADMIN"));
router.use(requireCurrentAdminSession);

router.get("/export", adminTransactionController.exportTransactions);
router.get("/", adminTransactionController.getTransactions);
router.get("/:id", adminTransactionController.getTransactionDetail);

router.post("/:id/disputes", adminTransactionController.openDispute);
router.post(
  "/:id/disputes/:disputeId/events",
  adminTransactionController.appendDisputeEvent
);

module.exports = router;

