const express = require("express");
const router = express.Router();
const adminTransactionController = require("./transaction.controller");
const authMiddleware = require("../../middlewares/auth.middleware");

router.use(authMiddleware.verifyAccessToken);
router.use(authMiddleware.requireRole("ADMIN"));

router.get("/export", adminTransactionController.exportTransactions);
router.get("/", adminTransactionController.getTransactions);
router.get("/:id", adminTransactionController.getTransactionDetail);

module.exports = router;

