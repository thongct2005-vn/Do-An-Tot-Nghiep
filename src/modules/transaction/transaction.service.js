const transactionRepository = require("./transaction.repository");

const TransactionService = {
  async transferMoney({
    sourceUserId,
    destinationUserId,
    amount,
    description,
    idempotencyKey,
  }) {
    if (!sourceUserId || !destinationUserId) {
      const err = new Error("Thiếu thông tin người gửi hoặc người nhận");
      err.statusCode = 400;
      throw err;
    }

    if (sourceUserId === destinationUserId) {
      const err = new Error("Không thể chuyển tiền cho chính mình");
      err.statusCode = 400;
      throw err;
    }

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 1000 ||
      numAmount > 50000000
    ) {
      const err = new Error(
        "Số tiền chuyển phải từ 1 nghìn và tối đa là 50 triệu",
      );
      err.statusCode = 400;
      throw err;
    }

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
      const err = new Error("Thiếu thông tin người thực hiện giao dịch");
      err.statusCode = 400;
      throw err;
    }

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 1000 ||
      numAmount > 50000000
    ) {
      const err = new Error(
        "Số tiền nạp phải từ 1 nghìn và tối đa là 50 triệu",
      );
      err.statusCode = 400;
      throw err;
    }
    if (!linkedBankAccountId) {
      const err = new Error("Thiếu thông tin ngân hàng liên kết");
      err.statusCode = 400;
      throw err;
    }

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

  async withdrawnMoney({
    sourceUserId,
    amount,
    idempotencyKey,
    linkedBankAccountId,
  }) {
    if (!sourceUserId) {
      const err = new Error("Thiếu thông tin người thực hiện giao dịch");
      err.statusCode = 400;
      throw err;
    }

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 10000 ||
      numAmount > 50000000
    ) {
      const err = new Error(
        "Số tiền rút phải từ 10 nghìn và tối đa là 50 triệu",
      );
      err.statusCode = 400;
      throw err;
    }
    if (!linkedBankAccountId) {
      const err = new Error("Thiếu thông tin ngân hàng liên kết");
      err.statusCode = 400;
      throw err;
    }

    return await transactionRepository.withdrawnMoney({
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
      const err = new Error("Thiếu thông tin người gửi");
      err.statusCode = 400;
      throw err;
    }

    if (!referenceCode) {
      const err = new Error("Thiếu thông tin của mã QR");
      err.statusCode = 400;
      throw err;
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
      const err = new Error("Thiếu thông tin để lấy lịch sử giao dịch");
      err.statusCode = 400;
      throw err;
    }

    const maxLimit = Math.min(Number(limit) || 20, 20);

    const normalizedKeyword = keyword && keyword.trim() ? keyword.trim() : null;

    let parsedStartDate = null;
    let parsedEndDate = null;

    if (startDate) {
      parsedStartDate = new Date(startDate);
      if (isNaN(parsedStartDate.getTime())) {
        const err = new Error("Ngày bắt đầu không hợp lệ");
        err.statusCode = 400;
        throw err;
      }
    }

    if (endDate) {
      parsedEndDate = new Date(endDate);
      if (isNaN(parsedEndDate.getTime())) {
        const err = new Error("Ngày kết thúc không hợp lệ");
        err.statusCode = 400;
        throw err;
      }
      parsedEndDate.setHours(23, 59, 59, 999);
    }

    if (parsedStartDate && parsedEndDate && parsedStartDate > parsedEndDate) {
      const err = new Error(
        "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc",
      );
      err.statusCode = 400;
      throw err;
    }
    if (parsedStartDate) {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (parsedStartDate < oneYearAgo) {
        const err = new Error(
          "Chỉ có thể xem lịch sử giao dịch trong vòng 1 năm gần nhất",
        );
        err.statusCode = 400;
        throw err;
      }
    }

    const result = await transactionRepository.getTransferHistory(userId, {
      cursorId,
      limit: maxLimit,
      keyword: normalizedKeyword,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
    });

    return result;
  },

  async getCurrentMonthSummary(userId) {
    if (!userId) {
      const err = new Error("Thiếu thông tin để lấy tổng quan giao dịch");
      err.statusCode = 400;
      throw err;
    }

    const result = await transactionRepository.getCurrentMonthSummary(userId);

    return {
      total_expense: result.total_expense,
      total_income: result.total_income,
    };
  },
};

module.exports = TransactionService;
