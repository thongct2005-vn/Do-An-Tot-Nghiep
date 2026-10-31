(function () {
  // ====== Production ======
  const PRODUCTION_HOST = "http://localhost:3000";

  // ====== Sandbox ======
  const SANDBOX_HOST = "http://localhost:3001";

  const PROD_API_ROOT = PRODUCTION_HOST + "/api/v2/merchant";

  window.APP_CONFIG = {
    production: {
      API_ROOT: PROD_API_ROOT,

      AUTH_BASE: PROD_API_ROOT + "/auth",
      REFRESH_TOKEN: PROD_API_ROOT + "/auth/refresh-token",
      LOGOUT: PROD_API_ROOT + "/auth/logout",
      TOTP_STATUS: PROD_API_ROOT + "/auth/totp/status",
      TOTP_SETUP: PROD_API_ROOT + "/auth/totp/setup",
      TOTP_ENABLE: PROD_API_ROOT + "/auth/totp/enable",
      TOTP_DISABLE: PROD_API_ROOT + "/auth/totp/disable",

      DASHBOARD_BASE: PROD_API_ROOT + "/dashboard",
      INFO: PROD_API_ROOT + "/dashboard/info",
      CALLBACK: PROD_API_ROOT + "/dashboard/callback",
      RESET_API_KEY: PROD_API_ROOT + "/dashboard/reset-apikey",
      RESET_SECRET_KEY: PROD_API_ROOT + "/dashboard/reset-secretkey",

      TRANSACTION_BASE: PROD_API_ROOT + "/transaction",
      TRANSACTION_HISTORY: PROD_API_ROOT + "/transaction/history",
      TRANSACTION_SUMMARY: PROD_API_ROOT + "/transaction/summary",
      TRANSACTION_DETAIL: PROD_API_ROOT + "/transaction/history/{id}",
      TRANSACTION_STATS: PROD_API_ROOT + "/transaction/stats",
      TRANSACTION_TRANSFER: PROD_API_ROOT + "/transaction/transfer",
      TRANSACTION_TOPUP: PROD_API_ROOT + "/transaction/topup",
      TRANSACTION_WITHDRAW: PROD_API_ROOT + "/transaction/withdraw",
      TRANSACTION_RECEIVER: PROD_API_ROOT + "/transaction/receiver",
      TRANSACTION_OTP_SEND: PROD_API_ROOT + "/transaction/otp/send",
      TRANSACTION_OTP_RESEND: PROD_API_ROOT + "/transaction/otp/resend",
      TRANSACTION_OTP_VERIFY: PROD_API_ROOT + "/transaction/otp/verify",

      BANK_STATUS: PROD_API_ROOT + "/bank/status",
      BANK_LINK: PROD_API_ROOT + "/bank/link",
      BANK_BALANCE: PROD_API_ROOT + "/bank/balance/{id}",

      WALLET_CHECK_TRANSFER: PROD_API_ROOT + "/wallet/check-transfer",
      EP_CREATE_PAYMENT: PROD_API_ROOT + "/payments",
      EP_PAYMENT_STATUS: PROD_API_ROOT + "/payments/{order_id}",

      PRODUCT_STATS: PROD_API_ROOT + "/product/top-selling",
    },
    sandbox: {
      API_ROOT: SANDBOX_HOST + "/api/v2/merchant/sandbox",
      WALLET_API_URL: SANDBOX_HOST + "/api/v2/merchant/sandbox/wallet/balance",
      APK_URL: SANDBOX_HOST + "/api/v2/merchant/sandbox/download-apk",
    },
  };
})();
