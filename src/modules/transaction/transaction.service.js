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
      !Number.isFinite(numAmount) ||
      numAmount < 1000 ||
      numAmount > 50000000
    ) {
      const err = new Error(
        "Số tiền chuyển phải từ 1 nghìn và tối đa là 50 triệu",
      );
      err.statusCode = 400;
      throw err;
    }

    const fee = 0,
      transactionType = "TRANSFER",
      status = "SUCCESS";

    return await transactionRepository.transferMoney({
      sourceUserId,
      destinationUserId,
      amount: numAmount,
      fee,
      description,
      idempotencyKey,
      transactionType,
      status,
    });
  },
};

module.exports = TransactionService;
