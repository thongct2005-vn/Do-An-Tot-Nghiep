const express = require("express");
const router = express.Router();
const authRoutes = require("../modules/auth/auth.routes");
const otpRoutes = require("../modules/otp/otp.routes");
const walletRoutes = require('../modules/wallet/wallet.routes');
router.use("/auth", authRoutes);
router.use("/otp", otpRoutes);
router.use("/wallet", walletRoutes);
module.exports = router;
