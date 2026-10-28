const userRepository = require("../user/user.repository");
const walletRepository = require("./wallet.repository");
const bcrypt = require("bcrypt");
const tokenUtil = require("../../utils/jwt");
const { httpError } = require("../../utils/httpError");
const { parseAmount } = require("../../utils/amount");
const { computePinBinding } = require("../../utils/pinBinding");

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

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

  async checkPin({ userId, pin, idempotencyKey, action, params }) {
    if (!userId || !pin) {
      throw httpError(400, "Thiếu thông tin để kiểm tra mã pin");
    }
    if (!idempotencyKey) {
      throw httpError(400, "Thiếu idempotency key của giao dịch");
    }
    
    const binding = computePinBinding(action, params);

    const state = await userRepository.getPinState(userId);
    if (!state?.pin_hash) {
      throw httpError(400, "Người dùng chưa thiết lập mã pin");
    }

    if (state.pin_locked_until) {
      if (state.is_locked) {
        throw httpError(
          403,
          `Bạn đã nhập sai PIN quá nhiều lần. Vui lòng thử lại sau ${PIN_LOCK_MINUTES} phút`,
        );
      }
      await userRepository.resetFailedPin(userId);
      state.pin_failed_attempts = 0;
    }

    const isCorrectPin = await bcrypt.compare(pin, state.pin_hash);
    if (!isCorrectPin) {
      const row = await userRepository.registerFailedPin({
        userId,
        maxAttempts: MAX_PIN_ATTEMPTS,
        lockMinutes: PIN_LOCK_MINUTES,
      });
      const attempts = Number(row?.pin_failed_attempts ?? MAX_PIN_ATTEMPTS);
      if (attempts >= MAX_PIN_ATTEMPTS) {
        throw httpError(
          403,
          `Bạn đã nhập sai PIN ${MAX_PIN_ATTEMPTS} lần. Tạm khóa ${PIN_LOCK_MINUTES} phút`,
        );
      }
      return {
        is_correct: false,
        remaining_attempts: MAX_PIN_ATTEMPTS - attempts,
      };
    }

    if (state.pin_failed_attempts > 0) {
      await userRepository.resetFailedPin(userId);
    }

    return {
      is_correct: true,
      pin_token: tokenUtil.generatePinToken({
        userId,
        idempotencyKey,
        action,
        binding,
      }),
    };
  },
};

module.exports = walletService;