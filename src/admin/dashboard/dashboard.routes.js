const express = require("express");
const router = express.Router();
const adminDashboardController = require("./dashboard.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const requireCurrentAdminSession = require("../auth/adminSession.middleware");

router.use(authMiddleware.verifyAccessToken);
router.use(authMiddleware.requireRole("ADMIN"));
router.use(requireCurrentAdminSession);

router.get("/overview", adminDashboardController.getOverview);
router.get("/cashflow", adminDashboardController.getCashflow);
router.get("/transaction-volume", adminDashboardController.getTransactionVolume);

module.exports = router;
