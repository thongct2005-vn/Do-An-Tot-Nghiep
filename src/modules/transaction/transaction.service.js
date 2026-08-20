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

    if(!linkedBankAccountId){
       const err = new Error("Thiếu thông tin ngân hàng liên kết");
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

    return await transactionRepository.executeTopup({
      sourceUserId,
      amount: numAmount,
      fee: 0,
      idempotencyKey,
      transactionType: "TOPUP",
      status: "SUCCESS",
      linkedBankAccountId: linkedBankAccountId
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

  async getTransferHistory(userId, { cursorId, limit }) {
    if (!userId) {
      const err = new Error("Thiếu thông tin để lấy lịch sử giao dịch");
      err.statusCode = 400;
      throw err;
    }
    const maxLimit = Math.min(Number(limit) || 20, 20);
    const result = await transactionRepository.getTransferHistory(userId, {
      cursorId,
      maxLimit,
    });
    return result;
  },
};

module.exports = TransactionService;
