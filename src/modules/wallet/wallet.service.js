const userRepository = require("../user/user.repository");
const walletRepository = require("./wallet.repository");
const bcrypt = require("bcrypt");
const { httpError } = require("../../utils/httpError");

const walletService = {
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
    if (!amount) {
      throw httpError(400, "Thiếu dữ liệu để kiểm tra");
    }
    const wallet = await this.getWalletByUserId(userId);
    const currentBalance = wallet.balance;
    return {
      is_eligible: currentBalance >= amount,
      wallet_balance: currentBalance,
    };
  },

  async checkPin({ userId, pin }) {
    if (!userId || !pin) {
      throw httpError(400, "Thiếu thông tin để kiểm tra mã pin");
    }
    const result = await userRepository.checkPinStatus(userId);
    const pinHash = result?.pin_hash;
    if (!pinHash) {
      throw httpError(400, "Người dùng chưa thiết lập mã pin");
    }
    const isCorrectPin = await bcrypt.compare(pin, pinHash);
    return {
      is_correct: isCorrectPin,
    };
  },
};

module.exports = walletService;