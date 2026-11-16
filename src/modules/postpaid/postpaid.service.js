const postpaidRepository = require("./postpaid.repository");
const { httpError } = require("../../utils/httpError");
const { parseAmount } = require("../../utils/amount");
const { assertKyc } = require("../kyc/kyc.guard");
const { resolveOneYearRange } = require("../../utils/dateRange");

const postpaidService = {
  async getWalletInfo() {
    return postpaidRepository.getWalletInfo();
  },

  async getWalletOverview(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    return postpaidRepository.getWalletOverview(userId);
  },

  async activateWallet(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    await assertKyc(userId);
    return postpaidRepository.activateWallet({ userId });
  },

  async freezeWallet(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    return postpaidRepository.freezeWallet({ userId });
  },

  async unfreezeWallet(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    return postpaidRepository.unfreezeWallet({ userId });
  },

  async closeWallet(userId, { reason = "" } = {}) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    const cleanReason =
      typeof reason === "string" ? reason.trim().slice(0, 200) : "";
    return postpaidRepository.closeWallet({ userId, reason: cleanReason });
  },

  async getEntries(
    userId,
    {
      cursorId = null,
      limit,
      keyword = null,
      action = null,
      startDate = null,
      endDate = null,
    } = {},
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    const normalizedKeyword =
      keyword && String(keyword).trim() ? String(keyword).trim() : null;
    const normalizedAction =
      action && String(action).trim() ? String(action).trim().toUpperCase() : null;

    const { startDate: startDay, endDate: endDay } = resolveOneYearRange(
      startDate,
      endDate,
      {
        defaultToOneYear: false,
        tooOldMessage:
          "Chỉ có thể xem lịch sử biến động trong vòng 1 năm gần nhất",
      },
    );

    return postpaidRepository.getEntries(userId, {
      cursorId,
      limit,
      keyword: normalizedKeyword,
      action: normalizedAction,
      startDate: startDay,
      endDate: endDay,
    });
  },

  async processPostpaidQRPayment({ sourceUserId, referenceCode, idempotencyKey }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người thanh toán");
    }
    if (!referenceCode || !String(referenceCode).trim()) {
      throw httpError(400, "Thiếu thông tin của mã QR");
    }
    await assertKyc(sourceUserId);
    return postpaidRepository.processPostpaidQRPayment({
      sourceUserId,
      referenceCode: String(referenceCode).trim(),
      idempotencyKey,
    });
  },

  async repayDebt({ userId, amount, idempotencyKey }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    const parsedAmount = parseAmount(amount);
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      throw httpError(400, "Số tiền thanh toán dư nợ phải lớn hơn 0");
    }
    await assertKyc(userId);
    return postpaidRepository.repayDebt({
      userId,
      amount: parsedAmount,
      idempotencyKey,
    });
  },

  async refundPostpaidTransaction({
    originalTxId,
    refundAmount = null,
    reason = "",
    actorId = null,
    idempotencyKey = null,
  }) {
    if (!originalTxId) {
      throw httpError(400, "Thiếu mã giao dịch cần hoàn tiền");
    }
    let parsedRefund = null;
    if (refundAmount !== null && refundAmount !== undefined && refundAmount !== "") {
      parsedRefund = parseAmount(refundAmount);
      if (!Number.isSafeInteger(parsedRefund) || parsedRefund <= 0) {
        throw httpError(400, "Số tiền hoàn phải lớn hơn 0");
      }
    }
    return postpaidRepository.refundPostpaidTransaction({
      originalTxId,
      refundAmount: parsedRefund,
      reason,
      actorId,
      idempotencyKey,
    });
  },
};

module.exports = postpaidService;

