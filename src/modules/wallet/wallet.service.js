const userRepository = require("../user/user.repository");
const walletRepository = require("./wallet.repository");
const bcrypt = require("bcrypt");
const tokenUtil = require("../../utils/jwt");
const { httpError } = require("../../utils/httpError");
const { parseAmount } = require("../../utils/amount");
const { computePinBinding } = require("../../utils/pinBinding");
const { isValidPasswordOrPin } = require("../../utils/validators");

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
    // PIN phải là chuỗi đúng 6 số: chặn sớm, tránh bcrypt.compare ném lỗi 500 khi pin không phải string
    if (!isValidPasswordOrPin(pin)) {
      throw httpError(400, "Mã PIN không hợp lệ");
    }
    if (!idempotencyKey) {
      throw httpError(400, "Thiếu idempotency key của giao dịch");
    }

    const binding = computePinBinding(action, params);

    // Trừ lượt thử TRƯỚC khi so PIN (1 câu SQL atomic) để request song song không lách được giới hạn.
    const claimed = await userRepository.claimPinAttempt({
      userId,
      maxAttempts: MAX_PIN_ATTEMPTS,
      lockMinutes: PIN_LOCK_MINUTES,
    });

    if (!claimed) {
      // Không trừ được lượt: hoặc chưa có PIN, hoặc đang bị khoá
      const state = await userRepository.getPinState(userId);
      if (!state?.pin_hash) {
        throw httpError(400, "Người dùng chưa thiết lập mã pin");
      }
      throw httpError(
        403,
        `Bạn đã nhập sai PIN quá nhiều lần. Vui lòng thử lại sau ${PIN_LOCK_MINUTES} phút`,
      );
    }

    const attempts = Number(claimed.pin_failed_attempts);
    const isCorrectPin = await bcrypt.compare(pin, claimed.pin_hash);

    if (!isCorrectPin) {
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


    await userRepository.resetFailedPin(userId);

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