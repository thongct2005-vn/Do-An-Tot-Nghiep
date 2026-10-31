const express = require("express");
const router = express.Router();

//USER
const authRoutes = require("../modules/auth/auth.routes");
const otpRoutes = require("../modules/otp/otp.routes");
const walletRoutes = require("../modules/wallet/wallet.routes");
const userRoutes = require("../modules/user/user.routes");
const transactionRoutes = require("../modules/transaction/transaction.routes");
const paymentRequestRoutes = require("../modules/paymentRequest/paymentRequest.routes");
const bankRoutes = require("../modules/bank/bank.routes");
const { apiRouter: payPageApiRoutes } = require("../modules/paymentPage/paymentPage.routes");
const kycRoutes = require("../modules/kyc/kyc.routes");

//ADMIN
const adminAuthRoutes = require("../admin/auth/auth.routes");
const adminUserRoutes = require("../admin/user/user.routes");

//MERCHANT PRODUCTION
const merchantAuthRoutes = require("../admin/merchant/production/auth/auth.routes");
const merchantDashBoardRoutes = require("../admin/merchant/production/dashboard/dashboard.routes");
const merchantPaymentRequestRoutes = require("../admin/merchant/production/paymentRequest/paymentRequest.routes");
const merchantTransactionRoutes = require("../admin/merchant/production/transaction/transaction.routes");
const merchantProductRoutes = require("../admin/merchant/production/product/product.routes");
const merchantBankRoutes = require("../admin/merchant/production/bank/bank.routes");
const merchantOtpRoutes = require("../admin/merchant/production/otp/otp.routes");
const merchantWalletRoutes = require("../admin/merchant/production/wallet/wallet.routes");
const merchantSandboxAuthRoutes = require("../admin/merchant/sandbox/auth/auth.routes");
const merchantSandboxDashBoardRoutes = require("../admin/merchant/sandbox/dashboard/dashboard.routes");
const merchantSandboxPaymentRoutes = require("../admin/merchant/sandbox/paymentRequest/paymentRequest.routes");
const userSandboxAuthRoutes = require("../admin/merchant/sandbox/user/auth/auth.routes");
const merchantSandboxWalletRoutes = require("../admin/merchant/sandbox/wallet/wallet.routes");

//ROUTER
router.use("/auth", authRoutes);
router.use("/otp", otpRoutes);
router.use("/wallet", walletRoutes);
router.use("/user", userRoutes);
router.use("/transaction", transactionRoutes);
router.use("/payment", paymentRequestRoutes);
router.use("/pay", payPageApiRoutes);
router.use("/bank", bankRoutes);
router.use("/kyc", kycRoutes);

//ADMIN ROUTES
router.use("/admin/auth", adminAuthRoutes);
router.use("/admin/user", adminUserRoutes);

//MERCHANT PRODUCTION ROUTES
router.use("/merchant/auth", merchantAuthRoutes);
router.use("/merchant/dashboard", merchantDashBoardRoutes);
router.use("/merchant", merchantPaymentRequestRoutes);
router.use("/merchant/transaction", merchantTransactionRoutes);
router.use("/merchant/product", merchantProductRoutes);
router.use("/merchant/bank", merchantBankRoutes);
router.use("/merchant/otp", merchantOtpRoutes);
router.use("/merchant/wallet", merchantWalletRoutes);

//MERCHANT SANDBOX ROUTES
router.use("/merchant/sandbox/auth", merchantSandboxAuthRoutes);
router.use("/merchant/sandbox/wallet", merchantSandboxWalletRoutes);
router.use("/merchant/sandbox/dashboard", merchantSandboxDashBoardRoutes);
router.use("/user/sandbox/auth", userSandboxAuthRoutes);
router.use("/merchant/sandbox", merchantSandboxPaymentRoutes);
module.exports = router;