const transactionRepository = require("./transaction.repository");
const { httpError } = require("../../utils/httpError");
const kycRepository = require("../kyc/kyc.repository");
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

    const sourceUserKYC = await kycRepository.checkUserKYC(sourceUserId);
    const destUserKYC = await kycRepository.checkUserKYC(destinationUserId);
    if (!sourceUserKYC.is_kyc) {
      throw httpError(403, "Tài khoản chưa xác thực danh tính");
    }

    if (!destUserKYC.is_kyc) {
      throw httpError(403, "Người nhận chưa xác thực danh tính");
    }

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 1000 ||
      numAmount > 50000000
    ) {
      throw httpError(
        400,
        "Số tiền chuyển phải từ 1 nghìn và tối đa là 50 triệu",
      );
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
      throw httpError(400, "Thiếu thông tin người thực hiện giao dịch");
    }

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 1000 ||
      numAmount > 50000000
    ) {
      throw httpError(400, "Số tiền nạp phải từ 1 nghìn và tối đa là 50 triệu");
    }
    if (!linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
    }

    const sourceUserKYC = await kycRepository.checkUserKYC(sourceUserId);
    if (!sourceUserKYC.is_kyc) {
      throw httpError(403, "Tài khoản chưa xác thực danh tính");
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
      throw httpError(400, "Thiếu thông tin người thực hiện giao dịch");
    }

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 10000 ||
      numAmount > 50000000
    ) {
      throw httpError(
        400,
        "Số tiền rút phải từ 10 nghìn và tối đa là 50 triệu",
      );
    }
    if (!linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
    }

    const sourceUserKYC = await kycRepository.checkUserKYC(sourceUserId);
    if (!sourceUserKYC.is_kyc) {
      throw httpError(403, "Tài khoản chưa xác thực danh tính");
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
      throw httpError(400, "Thiếu thông tin người gửi");
    }

    const sourceUserKYC = await kycRepository.checkUserKYC(sourceUserId);
    if (!sourceUserKYC.is_kyc) {
      throw httpError(403, "Tài khoản chưa xác thực danh tính");
    }

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

    const maxLimit = Math.min(Number(limit) || 20, 20);

    const normalizedKeyword = keyword && keyword.trim() ? keyword.trim() : null;

    let parsedStartDate = null;
    let parsedEndDate = null;

    if (startDate) {
      parsedStartDate = new Date(startDate);
      if (isNaN(parsedStartDate.getTime())) {
        throw httpError(400, "Ngày bắt đầu không hợp lệ");
      }
    }

    if (endDate) {
      parsedEndDate = new Date(endDate);
      if (isNaN(parsedEndDate.getTime())) {
        throw httpError(400, "Ngày kết thúc không hợp lệ");
      }
      parsedEndDate.setHours(23, 59, 59, 999);
    }

    if (parsedStartDate && parsedEndDate && parsedStartDate > parsedEndDate) {
      throw httpError(400, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
    }
    if (parsedStartDate) {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (parsedStartDate < oneYearAgo) {
        throw httpError(
          400,
          "Chỉ có thể xem lịch sử giao dịch trong vòng 1 năm gần nhất",
        );
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
