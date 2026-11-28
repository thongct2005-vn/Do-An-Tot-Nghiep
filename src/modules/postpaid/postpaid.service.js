// postpaid.service.js: Nghiệp vụ Ví trả sau (xem quy định, mở/đóng/khóa, biến động, thanh toán dư nợ, hoàn tiền, mở khóa).
const postpaidRepository = require("./postpaid.repository");
const { httpError } = require("../../utils/common/http");
const {
  parseAmount,
  assertBankFundingMinAmount,
} = require("../../utils/common/amount");
const { assertKyc } = require("../kyc/kyc.guard");
const pool = require("../../config/database");
const { getPositiveIntConfig } = require("../../utils/limits/limitsDb");
const {
  resolveExportRange,
  resolveOneYearRange,
} = require("../../utils/common/dateRange");
const { normalizeAmountRange } = require("../../utils/payment/historyFilters");
const {
  buildPostpaidEntriesXlsx,
  buildPostpaidExportFileName,
} = require("../../utils/files/exportExcel");
const { sendPostpaidExportEmail } = require("../../utils/notifications/mailer");
const { maskEmail } = require("../../utils/common/text");
const transactionRepository = require("../transaction/transaction.repository");

const ALLOWED_POSTPAID_DELTA_DIRECTIONS = ["INCREASE", "DECREASE"];

function normalizePostpaidDeltaDirection(rawDirection) {
  if (rawDirection === undefined || rawDirection === null) return null;
  const trimmed = String(rawDirection).trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (!ALLOWED_POSTPAID_DELTA_DIRECTIONS.includes(upper)) {
    throw httpError(400, "Chiều biến động dư nợ không hợp lệ");
  }
  return upper;
}

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
      direction = null,
      minAmount = null,
      maxAmount = null,
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
    const normalizedDirection = normalizePostpaidDeltaDirection(direction);
    const { minAmount: parsedMinAmount, maxAmount: parsedMaxAmount } =
      normalizeAmountRange(minAmount, maxAmount);

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
      direction: normalizedDirection,
      minAmount: parsedMinAmount,
      maxAmount: parsedMaxAmount,
      startDate: startDay,
      endDate: endDay,
    });
  },

  /** Xuất lịch sử biến động Ví trả sau ra file Excel và gửi đến email đã đăng ký (App). */
  async exportEntriesToEmail(
    userId,
    {
      keyword = null,
      action = null,
      direction = null,
      minAmount = null,
      maxAmount = null,
      startDate = null,
      endDate = null,
    } = {},
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để xuất lịch sử biến động Ví trả sau");
    }

    const range = resolveExportRange(startDate, endDate);
    const normalizedKeyword =
      keyword && String(keyword).trim() ? String(keyword).trim() : null;
    const normalizedAction =
      action && String(action).trim() ? String(action).trim().toUpperCase() : null;
    const normalizedDirection = normalizePostpaidDeltaDirection(direction);
    const { minAmount: parsedMinAmount, maxAmount: parsedMaxAmount } =
      normalizeAmountRange(minAmount, maxAmount);

    const email = await transactionRepository.getUserEmail(userId);
    if (!email) {
      throw httpError(400, "Tài khoản chưa có email đăng ký để nhận file");
    }

    const exportMaxRows = await getPositiveIntConfig("EXPORT_MAX_ROWS", pool);
    const rows = await postpaidRepository.exportEntries(userId, {
      keyword: normalizedKeyword,
      action: normalizedAction,
      direction: normalizedDirection,
      minAmount: parsedMinAmount,
      maxAmount: parsedMaxAmount,
      startDate: range.startDate,
      endDate: range.endDate,
      limit: exportMaxRows + 1,
    });

    if (rows.length === 0) {
      throw httpError(
        400,
        "Không có biến động Ví trả sau nào trong khoảng thời gian này",
      );
    }
    if (rows.length > exportMaxRows) {
      throw httpError(
        400,
        `Có hơn ${exportMaxRows.toLocaleString("vi-VN")} biến động trong khoảng thời gian này, vui lòng chọn khoảng ngắn hơn`,
      );
    }

    const buffer = await buildPostpaidEntriesXlsx({
      rows,
      startDate: range.startDate,
      endDate: range.endDate,
      filters: normalizedKeyword ? [`từ khóa "${normalizedKeyword}"`] : [],
    });

    await sendPostpaidExportEmail({
      to: email,
      buffer,
      fileName: buildPostpaidExportFileName(range.startDate, range.endDate),
      startDate: range.startDate,
      endDate: range.endDate,
      rowCount: rows.length,
    });

    await transactionRepository.recordAuditSafe({
      eventType: "POSTPAID_ENTRIES_EXPORTED",
      payload: {
        user_id: userId,
        channel: "APP_EMAIL",
        start_date: range.startDate,
        end_date: range.endDate,
        keyword: normalizedKeyword,
        row_count: rows.length,
      },
    });

    return { email: maskEmail(email), row_count: rows.length };
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

