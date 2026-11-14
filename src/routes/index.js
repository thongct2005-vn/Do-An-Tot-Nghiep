const express = require("express");
const router = express.Router();
const sanitizeRequest = require("../middlewares/sanitize.middleware");

// Lọc ký tự đặc biệt cho mọi request (body + query)
router.use(sanitizeRequest);

//USER
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
const merchantAuthRoutes = require("../modules/merchant/production/auth/auth.routes");
const createMerchantDashboardRoutes = require("../modules/merchant/shared/dashboard");
const createMerchantPaymentRequestRoutes = require("../modules/merchant/shared/paymentRequest");
const merchantTransactionRoutes = require("../modules/merchant/production/transaction/transaction.routes");
const merchantProductRoutes = require("../modules/merchant/production/product/product.routes");
const merchantBankRoutes = require("../modules/merchant/production/bank/bank.routes");
const merchantFeeRoutes = require("../modules/merchant/production/fee/fee.routes");
const createMerchantWalletModule = require("../modules/merchant/shared/wallet");
const merchantSandboxAuthRoutes = require("../modules/merchant/sandbox/auth/auth.routes");
const userSandboxAuthRoutes = require("../modules/merchant/sandbox/user/auth/auth.routes");
const createMerchantSandboxWalletRoutes = require("../modules/merchant/sandbox/wallet");
const merchantDashboardRoutes = createMerchantDashboardRoutes("production");
const merchantPaymentRequestRoutes = createMerchantPaymentRequestRoutes("production");
const merchantWalletRoutes = createMerchantWalletModule().router;
const merchantSandboxDashboardRoutes = createMerchantDashboardRoutes("sandbox");
const merchantSandboxPaymentRoutes = createMerchantPaymentRequestRoutes("sandbox");
const merchantSandboxWalletRoutes = createMerchantSandboxWalletRoutes();

//ADMIN
const adminDashboardRoutes = require("../admin/dashboard/dashboard.routes");
const adminUserRoutes = require("../admin/user/user.routes");
const adminAuthRoutes = require("../admin/auth/auth.routes");
const adminTransactionRoutes = require("../admin/transaction/transaction.routes");
const adminMerchantsRoutes = require("../admin/merchants/merchants.routes");

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
router.use("/admin/dashboard", adminDashboardRoutes);
router.use("/admin/auth", adminAuthRoutes);
router.use("/admin/user", adminUserRoutes);
router.use("/admin/transactions", adminTransactionRoutes);
router.use("/admin/merchants", adminMerchantsRoutes);


//MERCHANT PRODUCTION ROUTES
router.use("/merchant/auth", merchantAuthRoutes);
router.use("/merchant/dashboard", merchantDashboardRoutes);
router.use("/merchant", merchantPaymentRequestRoutes);
router.use("/merchant/transaction", merchantTransactionRoutes);
router.use("/merchant/product", merchantProductRoutes);
router.use("/merchant/bank", merchantBankRoutes);
router.use("/merchant/fee", merchantFeeRoutes);
router.use("/merchant/wallet", merchantWalletRoutes);


if (process.env.NODE_ENV === "sandbox") {
  router.use("/merchant/sandbox/auth", merchantSandboxAuthRoutes);
  router.use("/merchant/sandbox/wallet", merchantSandboxWalletRoutes);
  router.use("/merchant/sandbox/dashboard", merchantSandboxDashboardRoutes);
  router.use("/user/sandbox/auth", userSandboxAuthRoutes);
  router.use("/merchant/sandbox", merchantSandboxPaymentRoutes);
}

module.exports = router;