const express = require("express");
const router = express.Router();
const authRoutes = require("../modules/auth/auth.routes");
const otpRoutes = require("../modules/otp/otp.routes");
const walletRoutes = require("../modules/wallet/wallet.routes");
const userRoutes = require("../modules/user/user.routes");
const transactionRoutes = require("../modules/transaction/transaction.routes");
const paymentRequestRoutes = require("../modules/paymentRequest/paymentRequest.routes");
const bankRoutes = require("../modules/bank/bank.routes");
const {
  apiRouter: payPageApiRoutes,
} = require("../modules/paymentPage/paymentPage.routes");
const kycRoutes = require("../modules/kyc/kyc.routes");
const merchantAuthRoutes = require("../admin/merchant/production/auth/auth.routes");
const createMerchantDashboardRoutes = require("../admin/merchant/shared/dashboard");
const createMerchantPaymentRequestRoutes = require("../admin/merchant/shared/paymentRequest");
const merchantTransactionRoutes = require("../admin/merchant/production/transaction/transaction.routes");
const merchantProductRoutes = require("../admin/merchant/production/product/product.routes");
const merchantBankRoutes = require("../admin/merchant/production/bank/bank.routes");
const createMerchantWalletModule = require("../admin/merchant/shared/wallet");
const merchantSandboxAuthRoutes = require("../admin/merchant/sandbox/auth/auth.routes");
const userSandboxAuthRoutes = require("../admin/merchant/sandbox/user/auth/auth.routes");
const createMerchantSandboxWalletRoutes = require("../admin/merchant/sandbox/wallet");
const merchantDashboardRoutes = createMerchantDashboardRoutes("production");
const merchantPaymentRequestRoutes = createMerchantPaymentRequestRoutes("production");
const merchantWalletRoutes = createMerchantWalletModule().router;
const merchantSandboxDashboardRoutes = createMerchantDashboardRoutes("sandbox");
const merchantSandboxPaymentRoutes = createMerchantPaymentRequestRoutes("sandbox");
const merchantSandboxWalletRoutes = createMerchantSandboxWalletRoutes();

router.use("/auth", authRoutes);
router.use("/otp", otpRoutes);
router.use("/wallet", walletRoutes);
router.use("/user", userRoutes);
router.use("/transaction", transactionRoutes);
router.use("/payment", paymentRequestRoutes);
router.use("/pay", payPageApiRoutes);
router.use("/bank", bankRoutes);
router.use("/kyc", kycRoutes);
router.use("/merchant/auth", merchantAuthRoutes);
router.use("/merchant/dashboard", merchantDashboardRoutes);
router.use("/merchant", merchantPaymentRequestRoutes);
router.use("/merchant/transaction", merchantTransactionRoutes);
router.use("/merchant/product", merchantProductRoutes);
router.use("/merchant/bank", merchantBankRoutes);
router.use("/merchant/wallet", merchantWalletRoutes);


if (process.env.NODE_ENV !== "production") {
  router.use("/merchant/sandbox/auth", merchantSandboxAuthRoutes);
  router.use("/merchant/sandbox/wallet", merchantSandboxWalletRoutes);
  router.use("/merchant/sandbox/dashboard", merchantSandboxDashboardRoutes);
  router.use("/user/sandbox/auth", userSandboxAuthRoutes);
  router.use("/merchant/sandbox", merchantSandboxPaymentRoutes);
}

module.exports = router;