const AMOUNT_MAX = 50_000_000;

module.exports = {
  AMOUNT: {
    TRANSFER:      { min: 1_000,  max: AMOUNT_MAX },
    TOPUP:         { min: 10_000,  max: AMOUNT_MAX },
    WITHDRAW:      { min: 10_000, max: AMOUNT_MAX },
    QR_PAYMENT:    { min: 1_000,  max: AMOUNT_MAX },
    SANDBOX_TOPUP: { min: 1_000,      max: AMOUNT_MAX },
  },
  HISTORY_PAGE_LIMIT: 20,
  CONTACT_CHECK_MAX_PHONES: 500,
};