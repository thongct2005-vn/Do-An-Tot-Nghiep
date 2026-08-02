const walletRepository = require('./wallet.repository');
const walletService = {
  async getWalletBalanceByUserId(userId) {
    if (!userId) {
      const err = new Error('Thiếu thông tin người dùng để lấy số dư');
      err.statusCode = 400;
      throw err;
    }
    const wallet = await walletRepository.getWalletBalanceByUserId(userId);
    if (!wallet) {
      const err = new Error('Không tìm thấy ví của người dùng');
      err.statusCode = 404;
      throw err;
    }
    return {
      balance: wallet.balance,
    };
  },

  async checkTransferEligibility({ user_id, amount }) {
    if (!amount) {
      const err = new Error('Thiếu dữ liệu để kiểm tra');
      err.statusCode = 400;
      throw err;
    }
    const wallet = await this.getWalletBalanceByUserId(user_id);
    const currentBalance = wallet.balance;
    return {
      is_eligible: currentBalance >= amount,
      wallet_balance: currentBalance,
    };
  },
};

module.exports = walletService;
