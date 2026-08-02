const userRepository = require("../user/user.repository");
const walletRepository = require("./wallet.repository");
const bcrypt = require("bcrypt");

const walletService = {
  async getWalletBalanceByUserId(userId) {
    if (!userId) {
      const err = new Error("Thiếu thông tin người dùng để lấy số dư");
      err.statusCode = 400;
      throw err;
    }
    const wallet = await walletRepository.getWalletBalanceByUserId(userId);
    if (!wallet) {
      const err = new Error("Không tìm thấy ví của người dùng");
      err.statusCode = 404;
      throw err;
    }
    return {
      balance: wallet.balance,
    };
  },

  async checkTransferEligibility({ userId, amount }) {
    if (!amount) {
      const err = new Error("Thiếu dữ liệu để kiểm tra");
      err.statusCode = 400;
      throw err;
    }
    const wallet = await this.getWalletBalanceByUserId(userId);
    const currentBalance = wallet.balance;
    return {
      is_eligible: currentBalance >= amount,
      wallet_balance: currentBalance,
    };
  },

  async checkPin({ userId, pin }) {
    if (!userId || !pin) {
      const err = new Error("Thiếu thông tin để kiểm tra mã pin");
      err.statusCode = 400;
      throw err;
    }
    const result = await userRepository.checkPinStatus(userId);
    const pinHash = result?.pin_hash;
    if (!pinHash) {
      const err = new Error("Người dùng chưa thiết lập mã pin");
      err.statusCode = 400;
      throw err;
    }
    const isCorrectPin = await bcrypt.compare(pin, pinHash);
    return {
      is_correct: isCorrectPin,
    };
  },
};

module.exports = walletService;
