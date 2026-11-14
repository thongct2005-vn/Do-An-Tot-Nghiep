const transactionRepository = require("./transaction.repository");
const { httpError } = require("../../utils/httpError");
const { parseAmountInRange } = require("../../utils/amount");
const pool = require("../../config/database");
const {
  getEffectiveTransactionLimit,
  getPositiveIntConfig,
} = require("../../utils/limitsDb");
const {
  getTransactionLimitsSummary,
  resolveRole,
} = require("../../utils/dailyLimit");
const {
  resolveExportRange,
  resolveOneYearRange,
} = require("../../utils/exportRange");
const {
  buildTransactionsXlsx,
  buildExportFileName,
} = require("../../utils/exportExcel");
const { sendTransactionExportEmail } = require("../../utils/mailer");
const { maskEmail } = require("../../utils/mask");
const { assertKyc, assertKycBoth } = require("../kyc/kyc.guard");
const paymentRequestRepository = require("../paymentRequest/paymentRequest.repository");
const merchantFeeService = require("../merchant/production/fee/fee.service");

async function resolveActorRole(userId, explicitRole = null) {
  if (explicitRole) return explicitRole;
  return (await resolveRole(pool, userId)) || "USER";
}

const TransactionService = {
  async transferMoney({
    sourceUserId,
    role = null,
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

    const actorRole = await resolveActorRole(sourceUserId, role);
    const transferRule = await getEffectiveTransactionLimit(pool, {
      userId: sourceUserId,
      role: actorRole,
      transactionType: "TRANSFER",
    });
    const numAmount = parseAmountInRange(amount, transferRule, "chuyển");

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
    role = null,
    amount,
    idempotencyKey,
    linkedBankAccountId,
  }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người thực hiện giao dịch");
    }

    const actorRole = await resolveActorRole(sourceUserId, role);
    const topupRule = await getEffectiveTransactionLimit(pool, {
      userId: sourceUserId,
      role: actorRole,
      transactionType: "TOPUP",
    });
    const numAmount = parseAmountInRange(amount, topupRule, "nạp");

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
    role = null,
    amount,
    idempotencyKey,
    linkedBankAccountId,
  }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người thực hiện giao dịch");
    }

    const actorRole = await resolveActorRole(sourceUserId, role);
    const withdrawRule = await getEffectiveTransactionLimit(pool, {
      userId: sourceUserId,
      role: actorRole,
      transactionType: "WITHDRAW",
    });
    const numAmount = parseAmountInRange(amount, withdrawRule, "rút");

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

    const historyPageLimit = await getPositiveIntConfig("HISTORY_PAGE_LIMIT", pool);
    const maxLimit = Math.min(
      Number(limit) || historyPageLimit,
      historyPageLimit,
    );

    const normalizedKeyword = keyword && keyword.trim() ? keyword.trim() : null;

    const { startDate: startDay, endDate: endDay } = resolveOneYearRange(
      startDate,
      endDate,
      {
        defaultToOneYear: true,
        tooOldMessage:
          "Chỉ có thể xem lịch sử giao dịch trong vòng 1 năm gần nhất",
      },
    );

    return await transactionRepository.getTransferHistory(userId, {
      cursorId,
      limit: maxLimit,
      keyword: normalizedKeyword,
      startDate: startDay,
      endDate: endDay,
    });
  },

  // Xuất lịch sử giao dịch ra file Excel và gửi đến email đã đăng ký (app)
  async exportHistoryToEmail(userId, { keyword, startDate, endDate }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để xuất lịch sử giao dịch");
    }

    const range = resolveExportRange(startDate, endDate);
    const normalizedKeyword = keyword && keyword.trim() ? keyword.trim() : null;

    const email = await transactionRepository.getUserEmail(userId);
    if (!email) {
      throw httpError(400, "Tài khoản chưa có email đăng ký để nhận file");
    }

    const exportMaxRows = await getPositiveIntConfig("EXPORT_MAX_ROWS", pool);
    const rows = await transactionRepository.exportHistory(userId, {
      keyword: normalizedKeyword,
      startDate: range.startDate,
      endDate: range.endDate,
      limit: exportMaxRows + 1,
    });
    if (rows.length === 0) {
      throw httpError(400, "Không có giao dịch nào trong khoảng thời gian này");
    }
    if (rows.length > exportMaxRows) {
      throw httpError(
        400,
        `Có hơn ${exportMaxRows.toLocaleString("vi-VN")} giao dịch trong khoảng thời gian này, vui lòng chọn khoảng ngắn hơn`,
      );
    }

    const buffer = await buildTransactionsXlsx({
      rows,
      startDate: range.startDate,
      endDate: range.endDate,
      filters: normalizedKeyword ? [`từ khóa "${normalizedKeyword}"`] : [],
    });

    await sendTransactionExportEmail({
      to: email,
      buffer,
      fileName: buildExportFileName(range.startDate, range.endDate),
      startDate: range.startDate,
      endDate: range.endDate,
      rowCount: rows.length,
    });

    await transactionRepository.recordAuditSafe({
      eventType: "TRANSACTION_HISTORY_EXPORTED",
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

  // Response chuyển tiền / thanh toán QR: chỉ trả những gì người gửi cần thấy.
  // Số dư người nhận (destBalanceAfter) không bao giờ được trả ra.
  toTransferResponse(result) {
    return {
      transactionId: result.transactionId,
      status: result.status,
      createdAt: result.createdAt,
      amount: result.amount,
      fee: result.fee,
      feeAmount: result.feeAmount ?? result.fee,
      feeRateSnapshot: result.feeRateSnapshot || null,
      netAmount: result.netAmount ?? result.amount,
      description: result.description,
      sourceUserName: result.sourceUserName,
      destinationUserName: result.destinationUserName,
      sourceBalanceAfter: result.sourceBalanceAfter,
    };
  },

  // Dành cho app: thêm id và SĐT người nhận để màn kết quả có nút "chuyển tiếp"
  toTransferReceiptResponse(result) {
    return {
      ...TransactionService.toTransferResponse(result),
      destinationId: result.destinationId,
      destinationPhone: result.destinationPhone,
    };
  },

  // Nội dung push thông báo nhận tiền (ghi rõ thực nhận và phí merchant nếu có)
  formatReceiveNotificationBody(result) {
    const netAmount = Number(result.netAmount ?? result.amount);
    const merchantFee = Number(result.merchantFee || 0);
    const baseText = `Bạn vừa nhận +${netAmount.toLocaleString("vi-VN")}đ từ ${result.sourceUserName}`;
    return merchantFee > 0
      ? `${baseText} (đã trừ phí ${merchantFee.toLocaleString("vi-VN")}đ)`
      : baseText;
  },

  // Response nạp / rút tiền
  toBankTransactionResponse(result) {
    return {
      transactionId: result.transactionId,
      status: result.status,
      createdAt: result.createdAt,
      amount: result.amount,
      fee: result.fee,
      feeAmount: result.feeAmount ?? result.fee,
      feeRateSnapshot: result.feeRateSnapshot || null,
      netAmount: result.netAmount ?? result.amount,
      withdrawQuota: result.withdrawQuota || null,
      bankName: result.bankName,
      sourceBalanceAfter: result.sourceBalanceAfter,
    };
  },

  async previewTransactionFee({
    userId,
    role = "USER",
    transactionType,
    amount,
    merchantUserId = null,
    referenceCode = null,
  }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    let resolvedMerchantId = merchantUserId || null;
    let resolvedAmount = amount;

    if (referenceCode && typeof referenceCode === "string" && referenceCode.trim()) {
      const pr = await paymentRequestRepository.findByReferenceCode(
        referenceCode.trim(),
      );
      if (!pr) {
        throw httpError(404, "Không tìm thấy mã thanh toán QR");
      }
      resolvedMerchantId = pr.destination_user_id;
      if (resolvedAmount === undefined || resolvedAmount === null) {
        resolvedAmount = Number(pr.amount);
      }
    }

    const isQrType = ["PAYMENT", "QR_PAYMENT"].includes(
      String(transactionType || "").trim().toUpperCase(),
    );

    return merchantFeeService.previewTransactionFee({
      transactionType,
      amount: resolvedAmount,
      actorUser: { id: userId, role },
      merchantUserId: resolvedMerchantId,
      role: isQrType ? undefined : role,
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

  async getTransactionLimits(userId, { role = "USER" } = {}) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để lấy hạn mức giao dịch");
    }

    return getTransactionLimitsSummary(pool, { userId, role });
  },
};

module.exports = TransactionService;