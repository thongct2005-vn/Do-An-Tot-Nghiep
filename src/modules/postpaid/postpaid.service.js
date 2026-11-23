// postpaid.service.js: Nghiệp vụ Ví trả sau (xem quy định, mở/đóng/khóa, biến động, thanh toán dư nợ, hoàn tiền, mở khóa).
const postpaidRepository = require("./postpaid.repository");
const { httpError } = require("../../utils/common/http");
const {
  parseAmount,
  assertBankFundingMinAmount,
} = require("../../utils/common/amount");
const { assertKyc } = require("../kyc/kyc.guard");
const { resolveOneYearRange } = require("../../utils/common/dateRange");
const transactionRepository = require("../transaction/transaction.repository");

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
    return postpaidRepository.processPostpaidQRPayment({
      sourceUserId,
      referenceCode: String(referenceCode).trim(),
      idempotencyKey,
    });
  },

  async repayDebt({
    userId,
    amount,
    idempotencyKey,
    fundingSource = "MAIN_WALLET",
    linkedBankAccountId = null,
  }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    const normalizedFunding = String(
      fundingSource || (linkedBankAccountId ? "BANK" : "MAIN_WALLET"),
    )
      .trim()
      .toUpperCase();
    if (!["MAIN_WALLET", "BANK"].includes(normalizedFunding)) {
      throw httpError(400, "Nguồn tiền thanh toán không hợp lệ");
    }
    if (normalizedFunding === "BANK" && !linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
    }
    const isBankFunded = normalizedFunding === "BANK";

    const parsedAmount = parseAmount(amount);
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      throw httpError(400, "Số tiền thanh toán dư nợ phải lớn hơn 0");
    }
    await transactionRepository.runPreCheckWithFailureRecord(
      {
        transactionType: "PAYMENT",
        sourceUserId: userId,
        amount: parsedAmount,
        linkedBankAccountId: isBankFunded ? linkedBankAccountId : null,
        feeRateSnapshot: {
          funding_source: "POSTPAID",
          postpaid_action: "REPAY_PRINCIPAL",
          ...(isBankFunded ? { repay_funding_source: "BANK" } : {}),
        },
      },
      async () => {
        await assertKyc(userId);
        if (isBankFunded) {
          assertBankFundingMinAmount(parsedAmount, "thanh toán");
        }
      },
    );
    return postpaidRepository.repayDebt({
      userId,
      amount: parsedAmount,
      idempotencyKey,
      fundingSource: normalizedFunding,
      linkedBankAccountId: isBankFunded ? linkedBankAccountId : null,
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

  async createUnlockRequest({ userId, userNote = "", proofFiles = [] }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    const safeFiles = Array.isArray(proofFiles) ? proofFiles : [];
    if (safeFiles.length < 1 || safeFiles.length > 3) {
      throw httpError(400, "Vui lòng gửi từ 1 đến 3 ảnh chứng minh thu nhập");
    }
    const proofFileNames = safeFiles
      .map((f) => (f && typeof f.filename === "string" ? f.filename.trim() : ""))
      .filter(Boolean);
    if (proofFileNames.length !== safeFiles.length) {
      throw httpError(400, "Tệp ảnh chứng minh thu nhập không hợp lệ");
    }
    return postpaidRepository.createUnlockRequest({
      userId,
      userNote,
      proofFileNames,
    });
  },

  async getLatestUnlockRequest(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    return postpaidRepository.getLatestUnlockRequest(userId);
  },
};

module.exports = postpaidService;

