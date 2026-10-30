const transactionRepository = require("./transaction.repository");
const { httpError } = require("../../utils/httpError");
const { parseAmountInRange } = require("../../utils/amount");
const { AMOUNT, HISTORY_PAGE_LIMIT } = require("../../config/limits");
const { assertKyc, assertKycBoth } = require("../kyc/kyc.guard");
const { isValidDateOnly } = require("../../utils/validators");
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const TransactionService = {
  async transferMoney({
    sourceUserId,
    destinationUserId,
    amount,
    description,
    idempotencyKey,
  }) {
    if (!sourceUserId || !destinationUserId) {
      throw httpError(400, "Thiếu thông tin người gửi hoặc người nhận");
    }

    if (sourceUserId === destinationUserId) {
      throw httpError(400, "Không thể chuyển tiền cho chính mình");
    }

    await assertKycBoth(sourceUserId, destinationUserId);

    const numAmount = parseAmountInRange(amount, AMOUNT.TRANSFER, "chuyển");

    return await transactionRepository.transferMoney({
      sourceUserId,
      destinationUserId,
      amount: numAmount,
      fee: 0,
      description,
      idempotencyKey,
      transactionType: "TRANSFER",
      status: "SUCCESS",
    });
  },

  async topupMoney({
    sourceUserId,
    amount,
    idempotencyKey,
    linkedBankAccountId,
  }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người thực hiện giao dịch");
    }

    const numAmount = parseAmountInRange(amount, AMOUNT.TOPUP, "nạp");

    if (!linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
    }

    await assertKyc(sourceUserId);

    return await transactionRepository.topupMoney({
      sourceUserId,
      amount: numAmount,
      fee: 0,
      idempotencyKey,
      transactionType: "TOPUP",
      status: "SUCCESS",
      linkedBankAccountId: linkedBankAccountId,
    });
  },

  async withdrawMoney({
    sourceUserId,
    amount,
    idempotencyKey,
    linkedBankAccountId,
  }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người thực hiện giao dịch");
    }

    const numAmount = parseAmountInRange(amount, AMOUNT.WITHDRAW, "rút");

    if (!linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
    }

    await assertKyc(sourceUserId);

    return await transactionRepository.withdrawMoney({
      sourceUserId,
      amount: numAmount,
      fee: 0,
      idempotencyKey,
      transactionType: "WITHDRAW",
      status: "SUCCESS",
      linkedBankAccountId: linkedBankAccountId,
    });
  },

  async processQRPayment({ sourceUserId, idempotencyKey, referenceCode }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người gửi");
    }

    await assertKyc(sourceUserId);

    if (!referenceCode) {
      throw httpError(400, "Thiếu thông tin của mã QR");
    }

    return await transactionRepository.processQRPayment({
      sourceUserId,
      idempotencyKey,
      referenceCode,
      transactionType: "PAYMENT",
      status: "SUCCESS",
    });
  },

  async getTransferHistory(
    userId,
    { cursorId, limit, keyword, startDate, endDate },
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để lấy lịch sử giao dịch");
    }

    const maxLimit = Math.min(
      Number(limit) || HISTORY_PAGE_LIMIT,
      HISTORY_PAGE_LIMIT,
    );

    const normalizedKeyword = keyword && keyword.trim() ? keyword.trim() : null;

    let startDay = null;
    let endDay = null;

    if (startDate) {
      if (!isValidDateOnly(startDate)) {
        throw httpError(400, "Ngày bắt đầu không hợp lệ");
      }
      startDay = startDate;
    }
    if (endDate) {
      if (!isValidDateOnly(endDate)) {
        throw httpError(400, "Ngày kết thúc không hợp lệ");
      }
      endDay = endDate;
    }

    if (startDay && endDay && startDay > endDay) {
      throw httpError(400, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
    }
    if (startDay) {
      const oneYearAgo = new Date(Date.now() + VN_OFFSET_MS);
      oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
      if (startDay < oneYearAgo.toISOString().slice(0, 10)) {
        throw httpError(
          400,
          "Chỉ có thể xem lịch sử giao dịch trong vòng 1 năm gần nhất",
        );
      }
    }

    return await transactionRepository.getTransferHistory(userId, {
      cursorId,
      limit: maxLimit,
      keyword: normalizedKeyword,
      startDate: startDay,
      endDate: endDay,
    });
  },

  async getCurrentMonthSummary(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để lấy tổng quan giao dịch");
    }

    const result = await transactionRepository.getCurrentMonthSummary(userId);

    return {
      total_expense: result.total_expense,
      total_income: result.total_income,
    };
  },
};

module.exports = TransactionService;
