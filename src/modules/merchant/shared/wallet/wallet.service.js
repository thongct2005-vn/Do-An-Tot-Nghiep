// wallet.service.js: Factory service kiểm tra số dư và điều kiện chuyển tiền cho Merchant (production/sandbox).
const { createWalletCoreService } = require("../../../wallet/wallet.helpers");

function createWalletService({ walletRepository }) {
  return createWalletCoreService({ walletRepository });
}

module.exports = createWalletService;
