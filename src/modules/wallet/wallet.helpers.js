// wallet.helpers.js: Logic kiểm tra số dư ví và điều kiện chuyển tiền dùng chung cho App và Merchant.
const { httpError } = require("../../utils/common/http");
const { parseAmount } = require("../../utils/common/amount");

function createWalletCoreService({ walletRepository }) {
  return {
    async getWalletByUserId(userId) {
      if (!userId) {
        throw httpError(400, "Thiếu thông tin người dùng để lấy số dư");
      }
      const wallet = await walletRepository.getWalletBalanceByUserId(userId);
      if (!wallet) {
        throw httpError(404, "Không tìm thấy ví của người dùng");
      }
      return {
        balance: wallet.balance,
      };
    },

    async checkTransferEligibility({ userId, amount }) {
      if (amount === undefined || amount === null || amount === "") {
        throw httpError(400, "Thiếu dữ liệu để kiểm tra");
      }
      const amountNum = parseAmount(amount);
      const wallet = await this.getWalletByUserId(userId);
      const currentBalance = wallet.balance;
      return {
        is_eligible: Number(currentBalance) >= amountNum,
        wallet_balance: currentBalance,
      };
    },
  };
}

module.exports = {
  createWalletCoreService,
};

