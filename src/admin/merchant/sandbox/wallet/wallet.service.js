const userRepository = require("../../../../modules/user/user.repository");
const walletRepository = require("./wallet.repository");
const bcrypt = require("bcrypt");
const { httpError } = require("../../../../utils/httpError");
const { parseAmount } = require("../../../../utils/amount");

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

  async updateWalletBalance({ phone, amount }) {
    if (!phone || amount === undefined || amount === null || amount === "") {
      throw httpError(400, "Thiếu số điện thoại hoặc số tiền");
    }

    const numAmount = Number(amount);

    if (isNaN(numAmount) || !isFinite(numAmount)) {
      throw httpError(400, "Số tiền không hợp lệ");
    }

    if (numAmount < 1 || numAmount > 50000000) {
      throw httpError(400, "Số tiền phải từ 1 đến 50.000.000đ");
    }

    const user = await userRepository.findUserByPhone(phone);
    if (!user) {
      throw httpError(404, "Không tìm thấy tài khoản này");
    }

    await walletRepository.updateWalletBalance({ phone, amount: numAmount });
  },
};

module.exports = walletService;