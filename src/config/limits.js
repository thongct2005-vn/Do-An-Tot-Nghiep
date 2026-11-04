const AMOUNT_MAX = 50_000_000;

module.exports = {
  AMOUNT: {
    TRANSFER: { min: 1_000, max: AMOUNT_MAX },
    TOPUP: { min: 10_000, max: AMOUNT_MAX },
    WITHDRAW: { min: 10_000, max: AMOUNT_MAX },
    QR_PAYMENT: { min: 1_000, max: AMOUNT_MAX },
    SANDBOX_TOPUP: { min: 1_000, max: AMOUNT_MAX },
  },

  MERCHANT_AMOUNT: {
    WITHDRAW: { min: 10_000, max: 200_000_000 },
  },

  DAILY_LIMIT: {
    USER: {
      TRANSFER: 50_000_000,
      TOPUP: 50_000_000,
      WITHDRAW: 30_000_000,
    },
    MERCHANT: {
      TRANSFER: 50_000_000,
      TOPUP: 50_000_000,
      WITHDRAW: 500_000_000,
    },
  },
  DAILY_LIMIT_TIMEZONE: "Asia/Ho_Chi_Minh",

  HISTORY_PAGE_LIMIT: 20,
  CONTACT_CHECK_MAX_PHONES: 500,

  // Xuất Excel lịch sử giao dịch
  EXPORT: {
    MAX_DAYS: 31, // tối đa 31 ngày mỗi lần xuất
    MAX_ROWS: 10_000, // tối đa 10.000 dòng mỗi file
  },
};