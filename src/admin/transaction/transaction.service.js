const crypto = require("crypto");
const adminTransactionRepository = require("./transaction.repository");
const adminUserService = require("../user/user.service");
const adminUserRepository = require("../user/user.repository");
const { httpError } = require("../../utils/httpError");
const { uuidv7 } = require("uuidv7");
const {
  buildTransactionsAdminXlsx,
  buildExportFileName,
} = require("./transaction.export");
const {
  resolveAdminDateRange,
  getCurrentMonthBoundsInVietnam,
  getMondayOfDateStr,
} = require("../../utils/dateRange");

const ADMIN_REVERSE_REQUEST_PATH =
  "POST /api/v2/admin/transactions/:id/reverse";

function sanitizeReversalResponseData(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const copy = { ...raw };
  delete copy.admin_password;
  return copy;
}

function evaluatePostpaidRefundEligibility({ tx, postpaidSummary }) {
  const originalAmount = Number(tx?.amount || 0);
  if (!postpaidSummary) {
    return {
      is_postpaid_payment: false,
      buyer_user_id: null,
      buyer_name: null,
      buyer_phone: null,
      original_amount: originalAmount,
      refunded_amount: 0,
      remaining_refundable: 0,
      refund_count: 0,
      eligible: false,
      code: "NOT_POSTPAID_PAYMENT",
      reason: "Giao dịch không sử dụng nguồn Ví trả sau",
    };
  }

  const refundedAmount = Number(postpaidSummary.refunded_total || 0);
  const remainingRefundable = Math.max(0, originalAmount - refundedAmount);

  let eligible = true;
  let code = null;
  let reason = null;

  if (tx.status !== "SUCCESS" || tx.transaction_type !== "PAYMENT") {
    eligible = false;
    code = "POSTPAID_REFUND_UNSUPPORTED_TX";
    reason = "Chỉ hỗ trợ hoàn tiền cho giao dịch thanh toán đã thành công";
  } else if (remainingRefundable <= 0) {
    eligible = false;
    code = "POSTPAID_ALREADY_FULLY_REFUNDED";
    reason = "Giao dịch Ví trả sau này đã được hoàn đủ trước đó";
  } else if (!tx.destination_user_id) {
    eligible = false;
    code = "POSTPAID_MISSING_MERCHANT";
    reason = "Giao dịch gốc không có tài khoản cửa hàng nhận tiền";
  }

  return {
    is_postpaid_payment: true,
    buyer_user_id: String(postpaidSummary.buyer_user_id),
    buyer_name: postpaidSummary.buyer_name || null,
    buyer_phone: postpaidSummary.buyer_phone || null,
    original_amount: originalAmount,
    refunded_amount: refundedAmount,
    remaining_refundable: remainingRefundable,
    refund_count: Number(postpaidSummary.refund_count || 0),
    eligible,
    code,
    reason,
  };
}

function evaluateReversalEligibility({ tx, alreadyReversed, reversalInfo }) {
  if (!tx) {
    return { eligible: false, code: "NOT_FOUND", reason: "Không tìm thấy giao dịch" };
  }
  if (tx.transaction_type !== "TRANSFER") {
    return {
      eligible: false,
      code: "REVERSAL_UNSUPPORTED_TYPE",
      reason: "Chỉ hỗ trợ hoàn tiền cho giao dịch chuyển tiền P2P (TRANSFER)",
    };
  }
  if (tx.status !== "SUCCESS") {
    return {
      eligible: false,
      code: "REVERSAL_TX_NOT_SUCCESS",
      reason: "Chỉ được hoàn tiền giao dịch ở trạng thái Thành công (SUCCESS)",
    };
  }
  if (tx.linked_bank_account_id) {
    return {
      eligible: false,
      code: "REVERSAL_BANK_LINKED_NOT_ALLOWED",
      reason: "Không hỗ trợ hoàn tiền giao dịch có liên kết tài khoản ngân hàng",
    };
  }
  if (Number(tx.merchant_fee || 0) > 0) {
    return {
      eligible: false,
      code: "REVERSAL_MERCHANT_FEE_NOT_ALLOWED",
      reason: "Không hỗ trợ hoàn tiền giao dịch phát sinh phí Merchant",
    };
  }
  if (
    tx.fee_rate_snapshot?.operation_type === "REVERSAL" ||
    reversalInfo?.direction === "IS_REVERSAL"
  ) {
    return {
      eligible: false,
      code: "REVERSAL_CANNOT_REVERSE_REVERSAL",
      reason: "Không thể hoàn tiền đối với giao dịch bù trừ hoàn tiền",
    };
  }
  if (alreadyReversed || reversalInfo?.direction === "ORIGINAL_REVERSED") {
    return {
      eligible: false,
      code: "TRANSACTION_ALREADY_REVERSED",
      reason: "Giao dịch này đã được hoàn tiền trước đó",
    };
  }
  if (
    !tx.source_user_id ||
    !tx.destination_user_id ||
    String(tx.source_user_id) === String(tx.destination_user_id)
  ) {
    return {
      eligible: false,
      code: "REVERSAL_INVALID_WALLETS",
      reason: "Giao dịch không có cặp ví nguồn và ví đích hợp lệ khác nhau",
    };
  }
  if (
    (tx.source_user_role && tx.source_user_role !== "USER") ||
    (tx.destination_user_role && tx.destination_user_role !== "USER")
  ) {
    return {
      eligible: false,
      code: "REVERSAL_USER_WALLETS_ONLY",
      reason: "Chỉ hỗ trợ hoàn tiền giao dịch P2P giữa hai tài khoản người dùng (USER)",
    };
  }
  if (
    (tx.source_user_status && tx.source_user_status !== "ACTIVE") ||
    (tx.destination_user_status && tx.destination_user_status !== "ACTIVE")
  ) {
    return {
      eligible: false,
      code: "REVERSAL_ACCOUNT_NOT_ACTIVE",
      reason:
        "Cả ví người gửi cũ và ví người nhận cũ đều phải đang ở trạng thái hoạt động (ACTIVE)",
    };
  }
  if (
    tx.destination_user_balance !== undefined &&
    tx.destination_user_balance !== null &&
    Number(tx.destination_user_balance) < Number(tx.amount || 0)
  ) {
    return {
      eligible: false,
      code: "REVERSAL_INSUFFICIENT_BALANCE",
      reason: "Ví người nhận cũ hiện không đủ số dư để thực hiện hoàn tiền toàn bộ",
    };
  }
  return { eligible: true, code: null, reason: null };
}

const VALID_TRANSACTION_TYPES = [
  "ALL",
  "TRANSFER",
  "TOPUP",
  "WITHDRAW",
  "PAYMENT",
];
const VALID_TRANSACTION_STATUSES = ["ALL", "SUCCESS", "PENDING", "FAILED"];
const VALID_INITIATED_BY = ["ALL", "USER", "ADMIN", "SYSTEM"];
const VALID_ANOMALIES = [
  "ALL",
  "BALANCE_MISMATCH",
  "MISSING_SNAPSHOT",
  "STUCK_PENDING",
  "HIGH_VALUE_TX",
  "ACTIVE_DISPUTE",
];

const VALID_DISPUTE_TYPES = [
  "BALANCE_MISMATCH",
  "MISSING_SNAPSHOT",
  "STUCK_PENDING",
  "CUSTOMER_COMPLAINT",
  "OTHER",
];
const VALID_RESOLUTION_RESULTS = [
  "VALID_TRANSACTION",
  "CONFIRMED_DISCREPANCY",
  "REJECTED",
];

function parseDateRange({ period, startDate, endDate, now }) {
  let effectiveStart = startDate;
  let effectiveEnd = endDate;

  if (!effectiveStart && !effectiveEnd && period) {
    const vnBounds = getCurrentMonthBoundsInVietnam(now);
    const cleanPeriod = String(period).trim().toLowerCase();
    if (cleanPeriod === "today" || cleanPeriod === "day") {
      effectiveStart = vnBounds.endDate;
      effectiveEnd = vnBounds.endDate;
    } else if (cleanPeriod === "week") {
      effectiveStart = getMondayOfDateStr(vnBounds.endDate);
      effectiveEnd = vnBounds.endDate;
    } else if (cleanPeriod === "month") {
      effectiveStart = vnBounds.startDate;
      effectiveEnd = vnBounds.endDate;
    }
  }

  const range = resolveAdminDateRange(effectiveStart, effectiveEnd, { now });

  return {
    filterStartDate: range.startInstant,
    filterEndDate: range.nextDayInstant,
    periodInfo: {
      start_date: range.startDate,
      end_date: range.endDate,
      timezone: range.timezone,
    },
  };
}

function parseFilterParams({
  type,
  status,
  initiated_by,
  anomaly,
  period,
  start_date,
  end_date,
  now,
}) {
  const cleanType = type ? type.trim().toUpperCase() : "ALL";
  if (!VALID_TRANSACTION_TYPES.includes(cleanType)) {
    throw httpError(
      400,
      `Loại giao dịch không hợp lệ. Chỉ chấp nhận: ${VALID_TRANSACTION_TYPES.join(", ")}`
    );
  }

  const cleanStatus = status ? status.trim().toUpperCase() : "ALL";
  if (!VALID_TRANSACTION_STATUSES.includes(cleanStatus)) {
    throw httpError(
      400,
      `Trạng thái giao dịch không hợp lệ. Chỉ chấp nhận: ${VALID_TRANSACTION_STATUSES.join(", ")}`
    );
  }

  const cleanInitiatedBy = initiated_by
    ? initiated_by.trim().toUpperCase()
    : "ALL";
  if (!VALID_INITIATED_BY.includes(cleanInitiatedBy)) {
    throw httpError(
      400,
      `Nguồn thực hiện không hợp lệ. Chỉ chấp nhận: ${VALID_INITIATED_BY.join(", ")}`
    );
  }

  const cleanAnomaly = anomaly ? anomaly.trim().toUpperCase() : "ALL";
  if (!VALID_ANOMALIES.includes(cleanAnomaly)) {
    throw httpError(
      400,
      `Cảnh báo bất thường không hợp lệ. Chỉ chấp nhận: ${VALID_ANOMALIES.join(", ")}`
    );
  }

  const { filterStartDate, filterEndDate, periodInfo } = parseDateRange({
    period,
    startDate: start_date,
    endDate: end_date,
    now,
  });

  return {
    cleanType,
    cleanStatus,
    cleanInitiatedBy,
    cleanAnomaly,
    filterStartDate,
    filterEndDate,
    periodInfo,
  };
}

function calculateIntegrityAndAnomalies(t) {
  const amount = Number(t.amount || 0);
  const fee = Number(t.fee || 0);
  const merchantFee = Number(t.merchant_fee || 0);

  const hasSourceBefore =
    t.source_balance_before !== null && t.source_balance_before !== undefined;
  const hasSourceAfter =
    t.source_balance_after !== null && t.source_balance_after !== undefined;
  const hasDestBefore =
    t.dest_balance_before !== null && t.dest_balance_before !== undefined;
  const hasDestAfter =
    t.dest_balance_after !== null && t.dest_balance_after !== undefined;

  const sourceBefore = hasSourceBefore ? Number(t.source_balance_before) : null;
  const sourceAfter = hasSourceAfter ? Number(t.source_balance_after) : null;
  const destBefore = hasDestBefore ? Number(t.dest_balance_before) : null;
  const destAfter = hasDestAfter ? Number(t.dest_balance_after) : null;

  let overall_status = "OK";
  let source_snapshot_status = "NOT_APPLICABLE";
  let dest_snapshot_status = "NOT_APPLICABLE";
  const anomalies = [];

  const isSuccess = t.status === "SUCCESS";

  if (isSuccess) {
    if (
      t.transaction_type === "TRANSFER" ||
      (t.transaction_type === "PAYMENT" && t.destination_user_id)
    ) {
      const sourcePresent = hasSourceBefore && hasSourceAfter;
      const destPresent = hasDestBefore && hasDestAfter;

      if (!sourcePresent || !destPresent) {
        overall_status = "MISSING_SNAPSHOT";
        source_snapshot_status = sourcePresent ? "VALID" : "MISSING";
        dest_snapshot_status = destPresent ? "VALID" : "MISSING";
        anomalies.push({
          code: "MISSING_SNAPSHOT",
          severity: "WARNING",
          message: "Giao dịch thiếu dữ liệu ảnh chụp số dư (snapshot) bắt buộc",
        });
      } else {
        const isBankFunded = Boolean(t.linked_bank_account_id);
        const sourceExpected = isBankFunded
          ? sourceBefore
          : sourceBefore - (amount + fee);
        const sourceMatches = sourceAfter === sourceExpected;
        const destExpected = destBefore + amount - merchantFee;
        const destMatches = destAfter === destExpected;

        source_snapshot_status = sourceMatches ? "VALID" : "INVALID";
        dest_snapshot_status = destMatches ? "VALID" : "INVALID";

        if (sourceMatches && destMatches) {
          overall_status = "OK";
        } else {
          overall_status = "MISMATCH";
          anomalies.push({
            code: "BALANCE_MISMATCH",
            severity: "CRITICAL",
            message:
              "Số dư ví sau biến động không khớp với số tiền giao dịch và phí",
          });
        }
      }
    } else if (t.transaction_type === "PAYMENT") {
      // Thu phí hệ thống từ ví merchant (không có ví đích)
      dest_snapshot_status = "NOT_APPLICABLE";
      const sourcePresent = hasSourceBefore && hasSourceAfter;
      if (!sourcePresent) {
        overall_status = "MISSING_SNAPSHOT";
        source_snapshot_status = "MISSING";
        anomalies.push({
          code: "MISSING_SNAPSHOT",
          severity: "WARNING",
          message: "Giao dịch thu phí thiếu dữ liệu ảnh chụp số dư nguồn",
        });
      } else {
        const isBankFunded = Boolean(t.linked_bank_account_id);
        const sourceExpected = isBankFunded
          ? sourceBefore
          : sourceBefore - (amount + fee);
        const sourceMatches = sourceAfter === sourceExpected;
        source_snapshot_status = sourceMatches ? "VALID" : "INVALID";
        if (sourceMatches) {
          overall_status = "OK";
        } else {
          overall_status = "MISMATCH";
          anomalies.push({
            code: "BALANCE_MISMATCH",
            severity: "CRITICAL",
            message:
              "Số dư ví sau biến động không khớp với số tiền giao dịch và phí",
          });
        }
      }
    } else if (t.transaction_type === "TOPUP") {
      dest_snapshot_status = "NOT_APPLICABLE";
      const sourcePresent = hasSourceBefore && hasSourceAfter;

      if (!sourcePresent) {
        overall_status = "MISSING_SNAPSHOT";
        source_snapshot_status = "MISSING";
        anomalies.push({
          code: "MISSING_SNAPSHOT",
          severity: "WARNING",
          message: "Giao dịch nạp tiền thiếu dữ liệu ảnh chụp số dư nguồn",
        });
      } else {
        const sourceExpected = sourceBefore + amount;
        const sourceMatches = sourceAfter === sourceExpected;
        source_snapshot_status = sourceMatches ? "VALID" : "INVALID";

        if (sourceMatches) {
          overall_status = "OK";
        } else {
          overall_status = "MISMATCH";
          anomalies.push({
            code: "BALANCE_MISMATCH",
            severity: "CRITICAL",
            message: "Số dư ví sau nạp tiền không khớp với số tiền giao dịch",
          });
        }
      }
    } else if (t.transaction_type === "WITHDRAW") {
      dest_snapshot_status = "NOT_APPLICABLE";
      const sourcePresent = hasSourceBefore && hasSourceAfter;

      if (!sourcePresent) {
        overall_status = "MISSING_SNAPSHOT";
        source_snapshot_status = "MISSING";
        anomalies.push({
          code: "MISSING_SNAPSHOT",
          severity: "WARNING",
          message: "Giao dịch rút tiền thiếu dữ liệu ảnh chụp số dư nguồn",
        });
      } else {
        const sourceExpected = sourceBefore - (amount + fee);
        const sourceMatches = sourceAfter === sourceExpected;
        source_snapshot_status = sourceMatches ? "VALID" : "INVALID";

        if (sourceMatches) {
          overall_status = "OK";
        } else {
          overall_status = "MISMATCH";
          anomalies.push({
            code: "BALANCE_MISMATCH",
            severity: "CRITICAL",
            message:
              "Số dư ví sau rút tiền không khớp với số tiền giao dịch và phí",
          });
        }
      }
    }
  }

  // Cảnh báo độc lập 1: STUCK_PENDING (WARNING)
  if (t.status === "PENDING" && t.created_at) {
    const txTime = new Date(t.created_at).getTime();
    if (!isNaN(txTime) && txTime < Date.now() - 15 * 60 * 1000) {
      anomalies.push({
        code: "STUCK_PENDING",
        severity: "WARNING",
        message: "Giao dịch ở trạng thái PENDING quá 15 phút chưa hoàn tất",
      });
    }
  }

  // Cảnh báo độc lập 2: HIGH_VALUE_TX (INFO)
  if (amount >= 10000000) {
    anomalies.push({
      code: "HIGH_VALUE_TX",
      severity: "INFO",
      message: "Giao dịch có giá trị lớn (≥ 10.000.000 ₫)",
    });
  }

  return {
    integrity_checks: {
      overall_status,
      source_snapshot_status,
      dest_snapshot_status,
      checked_at: new Date().toISOString(),
    },
    anomalies,
  };
}

/**
 * Suy dẫn số tiền thực nhận về ví đích (hoặc ngân hàng nhận khi WITHDRAW)
 * trực tiếp từ amount và merchant_fee (cột net_amount đã bỏ khỏi DB).
 */
function resolveAdminNetAmount({ transactionType, amount, merchantFee }) {
  const type = String(transactionType || "").toUpperCase();
  if (type === "PAYMENT" || type === "TRANSFER") {
    return Math.max(0, amount - merchantFee);
  }
  return amount;
}

const adminTransactionService = {
  async getTransactions({
    page = 1,
    limit = 20,
    type,
    status,
    initiated_by,
    anomaly,
    keyword,
    period,
    start_date,
    end_date,
    now,
  }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const {
      cleanType,
      cleanStatus,
      cleanInitiatedBy,
      cleanAnomaly,
      filterStartDate,
      filterEndDate,
      periodInfo,
    } = parseFilterParams({
      type,
      status,
      initiated_by,
      anomaly,
      period,
      start_date,
      end_date,
      now,
    });

    const [total, rows] = await Promise.all([
      adminTransactionRepository.countTransactions({
        type: cleanType,
        status: cleanStatus,
        initiatedBy: cleanInitiatedBy,
        anomaly: cleanAnomaly,
        keyword,
        startDate: filterStartDate,
        endDate: filterEndDate,
      }),
      adminTransactionRepository.getTransactions({
        type: cleanType,
        status: cleanStatus,
        initiatedBy: cleanInitiatedBy,
        anomaly: cleanAnomaly,
        keyword,
        startDate: filterStartDate,
        endDate: filterEndDate,
        limit: limitNum,
        offset,
      }),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    const items = rows.map((t) => {
      const amount = Number(t.amount || 0);
      const fee = Number(t.fee || 0);
      const merchantFee = Number(t.merchant_fee || 0);
      return {
        id: String(t.id),
        transaction_type: t.transaction_type,
        amount,
        fee,
        merchant_fee: merchantFee,
        fee_rate_snapshot: t.fee_rate_snapshot || null,
        net_amount: resolveAdminNetAmount({
          transactionType: t.transaction_type,
          amount,
          merchantFee,
        }),
        status: t.status,
        description: t.description || "",
      source_user: t.source_user_id
        ? {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
          }
        : null,
      destination_user: t.destination_user_id
        ? {
            id: String(t.destination_user_id),
            full_name: t.destination_user_name || "Chưa cập nhật",
            phone: t.destination_user_phone || "",
          }
        : null,
      initiated_by: {
        role: t.initiator_role,
        action: t.initiator_role === "ADMIN" ? t.admin_action || null : null,
        admin_name:
          t.initiator_role === "ADMIN" ? t.admin_name || "Quản trị viên" : null,
        audit_verified: t.initiator_role === "ADMIN",
      },
      operation_type: t.fee_rate_snapshot?.operation_type || null,
      created_at: t.created_at,
      };
    });

    return {
      period: periodInfo,
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: totalPages,
      },
    };
  },

  async getTransactionDetail(id) {
    if (!id || String(id).trim() === "") {
      throw httpError(400, "Thiếu định danh giao dịch");
    }

    const cleanId = String(id).trim();

    const [t, timeline, disputeEvents] = await Promise.all([
      adminTransactionRepository.getTransactionDetailById(cleanId),
      adminTransactionRepository.getTransactionTimeline(cleanId),
      adminTransactionRepository.getDisputeEventsByTransactionId(cleanId),
    ]);

    if (!t) {
      throw httpError(404, "Không tìm thấy giao dịch");
    }

    const postpaidSummary =
      t.transaction_type === "PAYMENT"
        ? await adminTransactionRepository.getPostpaidRefundSummaryByTxId(cleanId)
        : null;

    const amount = Number(t.amount || 0);
    const fee = Number(t.fee || 0);
    const merchantFee = Number(t.merchant_fee || 0);

    const hasSourceSnapshot =
      t.source_balance_before !== null &&
      t.source_balance_before !== undefined &&
      t.source_balance_after !== null &&
      t.source_balance_after !== undefined;

    const hasDestSnapshot =
      t.dest_balance_before !== null &&
      t.dest_balance_before !== undefined &&
      t.dest_balance_after !== null &&
      t.dest_balance_after !== undefined;

    const sourceBefore = hasSourceSnapshot
      ? Number(t.source_balance_before)
      : null;
    const sourceAfter = hasSourceSnapshot
      ? Number(t.source_balance_after)
      : null;
    const destBefore = hasDestSnapshot
      ? Number(t.dest_balance_before)
      : null;
    const destAfter = hasDestSnapshot
      ? Number(t.dest_balance_after)
      : null;

    const adminIntervention = t.audit_history_id
      ? {
          is_admin_operation: true,
          action: t.admin_action,
          admin: {
            id: String(t.admin_id),
            full_name: t.admin_name || "Quản trị viên",
            email: t.admin_email || "",
          },
          reason: t.admin_reason,
          authorization_reference: t.admin_auth_ref || null,
          execution_mode: t.admin_execution_mode || null,
          original_transaction_id: t.admin_original_transaction_id || null,
          dispute_id: t.admin_dispute_id || null,
          executed_at: t.admin_executed_at,
        }
      : null;

    let reversalInfo = null;
    if (t.admin_action === "ADMIN_OP_REVERSAL" && t.admin_original_transaction_id) {
      reversalInfo = {
        direction: "IS_REVERSAL",
        related_transaction_id: String(t.admin_original_transaction_id),
        original_transaction_id: String(t.admin_original_transaction_id),
        reversal_transaction_id: String(t.id),
        reason: t.admin_reason || "",
        dispute_id: t.admin_dispute_id || null,
        reversed_at: t.admin_executed_at,
        admin: t.admin_id
          ? {
              id: String(t.admin_id),
              full_name: t.admin_name || "Quản trị viên",
              email: t.admin_email || "",
            }
          : null,
      };
    } else if (t.reversal_audit_id && t.reversal_tx_id) {
      reversalInfo = {
        direction: "ORIGINAL_REVERSED",
        related_transaction_id: String(t.reversal_tx_id),
        original_transaction_id: String(t.id),
        reversal_transaction_id: String(t.reversal_tx_id),
        reason: t.reversal_reason || "",
        dispute_id: t.reversal_dispute_id || null,
        reversed_at: t.reversed_at,
        admin: t.reversal_admin_id
          ? {
              id: String(t.reversal_admin_id),
              full_name: t.reversal_admin_name || "Quản trị viên",
              email: t.reversal_admin_email || "",
            }
          : null,
      };
    }

    const reversalEligibility = evaluateReversalEligibility({
      tx: t,
      alreadyReversed: Boolean(t.reversal_audit_id),
      reversalInfo,
    });
    const postpaidRefund = evaluatePostpaidRefundEligibility({
      tx: t,
      postpaidSummary,
    });

    // Phân tích integrity_checks và anomalies
    const { integrity_checks, anomalies } = calculateIntegrityAndAnomalies(t);

    // Phân tích hồ sơ tra soát (disputes)
    const disputeStatusMap = {};
    const disputeTypeMap = {};
    for (const ev of disputeEvents) {
      const dId = ev.new_values?.dispute_id || String(ev.id);
      const st =
        ev.new_values?.dispute_status ||
        (ev.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN");
      disputeStatusMap[dId] = st;
      if (!disputeTypeMap[dId] && ev.new_values?.dispute_type) {
        disputeTypeMap[dId] = ev.new_values.dispute_type;
      }
    }

    const activeDisputeEntry = Object.entries(disputeStatusMap).find(
      ([, st]) => st === "OPEN" || st === "INVESTIGATING"
    );

    let currentDisputeStatus = "NONE";
    let activeDisputeId = null;

    if (activeDisputeEntry) {
      activeDisputeId = activeDisputeEntry[0];
      currentDisputeStatus = activeDisputeEntry[1];
      anomalies.push({
        code: "ACTIVE_DISPUTE",
        severity: "INFO",
        message: "Giao dịch đang có hồ sơ tra soát xử lý",
      });
    } else if (disputeEvents.length > 0) {
      const lastEv = disputeEvents[disputeEvents.length - 1];
      currentDisputeStatus =
        lastEv.new_values?.dispute_status ||
        (lastEv.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "NONE");
    }

    const disputeHistory = disputeEvents.map((ev) => ({
      id: String(ev.id),
      dispute_id: ev.new_values?.dispute_id || String(ev.id),
      action: ev.action,
      dispute_status:
        ev.new_values?.dispute_status ||
        (ev.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN"),
      dispute_type:
        ev.new_values?.dispute_type ||
        disputeTypeMap[ev.new_values?.dispute_id] ||
        null,
      resolution_result: ev.new_values?.resolution_result || null,
      authorization_reference: ev.new_values?.authorization_reference || null,
      reason: ev.reason || "",
      note: ev.new_values?.note || ev.reason || "",
      admin: {
        id: String(ev.admin_id),
        full_name: ev.admin_name || "Quản trị viên",
        email: ev.admin_email || "",
      },
      created_at: ev.created_at,
    }));

    const disputeData = {
      current_status: currentDisputeStatus,
      active_dispute_id: activeDisputeId,
      history: disputeHistory,
    };

    const isConsistent = integrity_checks.overall_status === "OK";

    const baseData = {
      id: String(t.id),
      transaction_type: t.transaction_type,
      status: t.status,
      amount,
      fee,
      merchant_fee: merchantFee,
      fee_rate_snapshot: t.fee_rate_snapshot || null,
      net_amount: resolveAdminNetAmount({
        transactionType: t.transaction_type,
        amount,
        merchantFee,
      }),
      description: t.description || "",
      idempotency_key: t.idempotency_key,
      created_at: t.created_at,
      admin_intervention: adminIntervention,
      reversal_info: reversalInfo,
      reversal_eligibility: reversalEligibility,
      postpaid_refund: postpaidRefund,
      integrity_checks,
      anomalies,
      dispute: disputeData,
      timeline,
    };

    switch (t.transaction_type) {
      case "TRANSFER": {
        return {
          ...baseData,
          is_balance_consistent: isConsistent,
          sender: {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
            email: t.source_user_email || "",
            balance_before: sourceBefore,
            balance_after: sourceAfter,
            difference: hasSourceSnapshot
              ? t.linked_bank_account_id
                ? 0
                : -(amount + fee)
              : null,
          },
          receiver: {
            id: String(t.destination_user_id),
            full_name: t.destination_user_name || "Chưa cập nhật",
            phone: t.destination_user_phone || "",
            email: t.destination_user_email || "",
            balance_before: destBefore,
            balance_after: destAfter,
            difference: hasDestSnapshot ? amount - merchantFee : null,
          },
        };
      }

      case "TOPUP": {
        return {
          ...baseData,
          is_balance_consistent: isConsistent,
          user: {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
            email: t.source_user_email || "",
            balance_before: sourceBefore,
            balance_after: sourceAfter,
            difference: hasSourceSnapshot ? amount : null,
          },
          bank: {
            bank_name: t.bank_name || "Chưa cập nhật",
            bank_code: t.bank_code || "",
            account_number: t.bank_account_number || "",
            logo_url: t.bank_logo_url || null,
          },
        };
      }

      case "WITHDRAW": {
        return {
          ...baseData,
          is_balance_consistent: isConsistent,
          user: {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
            email: t.source_user_email || "",
            balance_before: sourceBefore,
            balance_after: sourceAfter,
            difference: hasSourceSnapshot ? -(amount + fee) : null,
          },
          bank: {
            bank_name: t.bank_name || "Chưa cập nhật",
            bank_code: t.bank_code || "",
            account_number: t.bank_account_number || "",
            logo_url: t.bank_logo_url || null,
          },
        };
      }

      case "PAYMENT": {
        return {
          ...baseData,
          is_balance_consistent: isConsistent,
          payer: {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
            email: t.source_user_email || "",
            balance_before: sourceBefore,
            balance_after: sourceAfter,
            difference: hasSourceSnapshot
              ? t.linked_bank_account_id
                ? 0
                : -(amount + fee)
              : null,
          },
          merchant: t.destination_user_id
            ? {
                id: String(t.destination_user_id),
                full_name: t.destination_user_name || "Chưa cập nhật",
                phone: t.destination_user_phone || "",
                email: t.destination_user_email || "",
                balance_before: destBefore,
                balance_after: destAfter,
                difference: hasDestSnapshot ? amount - merchantFee : null,
              }
            : null,
          payment_request: {
            reference_code: t.reference_code || null,
            order_id: t.order_id || null,
          },
        };
      }

      default: {
        return {
          ...baseData,
          is_balance_consistent: null,
          source_user: t.source_user_id
            ? {
                id: String(t.source_user_id),
                full_name: t.source_user_name || "Chưa cập nhật",
                phone: t.source_user_phone || "",
                email: t.source_user_email || "",
                balance_before: sourceBefore,
                balance_after: sourceAfter,
              }
            : null,
          destination_user: t.destination_user_id
            ? {
                id: String(t.destination_user_id),
                full_name: t.destination_user_name || "Chưa cập nhật",
                phone: t.destination_user_phone || "",
                email: t.destination_user_email || "",
                balance_before: destBefore,
                balance_after: destAfter,
              }
            : null,
        };
      }
    }
  },

  async openDispute(
    transactionId,
    { disputeType, reason, authorizationReference, note, currentUser }
  ) {
    if (!transactionId || String(transactionId).trim() === "") {
      throw httpError(400, "Thiếu định danh giao dịch");
    }
    const cleanTxId = String(transactionId).trim();

    const cleanDisputeType = disputeType ? disputeType.trim().toUpperCase() : "";
    if (!VALID_DISPUTE_TYPES.includes(cleanDisputeType)) {
      throw httpError(
        400,
        `Loại tra soát không hợp lệ. Chỉ chấp nhận: ${VALID_DISPUTE_TYPES.join(", ")}`
      );
    }

    if (!reason || !reason.trim()) {
      throw httpError(400, "Lý do mở tra soát không được để trống");
    }

    const adminId = currentUser?.user_id || currentUser?.id;
    if (!adminId) {
      throw httpError(401, "Yêu cầu đăng nhập quản trị viên để thực hiện thao tác");
    }

    const client = await adminTransactionRepository.getClient();
    try {
      await client.query("BEGIN");

      const tx = await adminTransactionRepository.lockTransactionForDispute(
        client,
        cleanTxId
      );
      if (!tx) {
        throw httpError(404, "Không tìm thấy giao dịch");
      }

      const targetUserId = tx.source_user_id || tx.destination_user_id;
      if (!targetUserId) {
        throw httpError(422, "Giao dịch không có tài khoản người dùng liên kết");
      }

      const existingEvents =
        await adminTransactionRepository.getDisputeEventsByTransactionId(
          cleanTxId,
          client
        );
      const disputeStatusMap = {};
      for (const ev of existingEvents) {
        const dId = ev.new_values?.dispute_id || String(ev.id);
        const st =
          ev.new_values?.dispute_status ||
          (ev.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN");
        disputeStatusMap[dId] = st;
      }

      const hasActive = Object.values(disputeStatusMap).some(
        (st) => st === "OPEN" || st === "INVESTIGATING"
      );
      if (hasActive) {
        throw httpError(
          409,
          "Giao dịch đang có hồ sơ tra soát đang hoạt động. Không thể mở thêm hồ sơ mới."
        );
      }

      const disputeId = uuidv7();
      const newValues = {
        transaction_id: cleanTxId,
        dispute_id: disputeId,
        dispute_status: "OPEN",
        dispute_type: cleanDisputeType,
        resolution_result: null,
        authorization_reference: authorizationReference
          ? authorizationReference.trim()
          : null,
        note: note ? note.trim() : reason.trim(),
      };

      const inserted = await adminTransactionRepository.insertDisputeEvent(
        client,
        {
          adminId,
          userId: targetUserId,
          action: "DISPUTE_OPENED",
          reason: reason.trim(),
          newValues,
        }
      );

      await client.query("COMMIT");

      return {
        dispute_id: disputeId,
        dispute_status: "OPEN",
        dispute_type: cleanDisputeType,
        transaction_id: cleanTxId,
        authorization_reference: newValues.authorization_reference,
        created_at: inserted.created_at,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async appendDisputeEvent(
    transactionId,
    disputeId,
    {
      action,
      disputeStatus,
      resolutionResult,
      reason,
      note,
      currentUser,
    }
  ) {
    if (!transactionId || String(transactionId).trim() === "") {
      throw httpError(400, "Thiếu định danh giao dịch");
    }
    if (!disputeId || String(disputeId).trim() === "") {
      throw httpError(400, "Thiếu định danh hồ sơ tra soát");
    }
    const cleanTxId = String(transactionId).trim();
    const cleanDisputeId = String(disputeId).trim();

    const cleanAction = action ? action.trim().toUpperCase() : "";
    if (!["DISPUTE_UPDATED", "DISPUTE_RESOLVED"].includes(cleanAction)) {
      throw httpError(
        400,
        "Hành động không hợp lệ. Chỉ chấp nhận: DISPUTE_UPDATED, DISPUTE_RESOLVED"
      );
    }

    let targetDisputeStatus = "INVESTIGATING";
    let cleanResolutionResult = null;

    if (cleanAction === "DISPUTE_RESOLVED") {
      targetDisputeStatus = "RESOLVED";
      cleanResolutionResult = resolutionResult
        ? resolutionResult.trim().toUpperCase()
        : "";
      if (!VALID_RESOLUTION_RESULTS.includes(cleanResolutionResult)) {
        throw httpError(
          400,
          `Kết quả kết luận không hợp lệ. Chỉ chấp nhận: ${VALID_RESOLUTION_RESULTS.join(", ")}`
        );
      }
    } else {
      if (disputeStatus) {
        const cleanStatus = disputeStatus.trim().toUpperCase();
        if (!["OPEN", "INVESTIGATING"].includes(cleanStatus)) {
          throw httpError(
            400,
            "Trạng thái cập nhật không hợp lệ. Chỉ chấp nhận: OPEN, INVESTIGATING"
          );
        }
        targetDisputeStatus = cleanStatus;
      }
    }

    const finalReason =
      reason && reason.trim()
        ? reason.trim()
        : note && note.trim()
        ? note.trim()
        : "";
    if (!finalReason) {
      throw httpError(400, "Lý do hoặc ghi chú cập nhật không được để trống");
    }

    const adminId = currentUser?.user_id || currentUser?.id;
    if (!adminId) {
      throw httpError(401, "Yêu cầu đăng nhập quản trị viên để thực hiện thao tác");
    }

    const client = await adminTransactionRepository.getClient();
    try {
      await client.query("BEGIN");

      const tx = await adminTransactionRepository.lockTransactionForDispute(
        client,
        cleanTxId
      );
      if (!tx) {
        throw httpError(404, "Không tìm thấy giao dịch");
      }

      const existingEvents =
        await adminTransactionRepository.getDisputeEventsByTransactionId(
          cleanTxId,
          client
        );
      const disputeEvents = existingEvents.filter(
        (ev) => (ev.new_values?.dispute_id || String(ev.id)) === cleanDisputeId
      );
      if (disputeEvents.length === 0) {
        throw httpError(
          404,
          "Không tìm thấy hồ sơ tra soát tương ứng với giao dịch này"
        );
      }

      const latestEv = disputeEvents[disputeEvents.length - 1];
      const currentStatus =
        latestEv.new_values?.dispute_status ||
        (latestEv.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN");
      if (currentStatus === "RESOLVED") {
        throw httpError(
          409,
          "Hồ sơ tra soát đã kết thúc (RESOLVED). Không thể cập nhật thêm."
        );
      }

      const initialEv = disputeEvents[0];
      const disputeType = initialEv.new_values?.dispute_type || "OTHER";
      const authorizationReference =
        initialEv.new_values?.authorization_reference || null;

      const targetUserId = tx.source_user_id || tx.destination_user_id;
      const newValues = {
        transaction_id: cleanTxId,
        dispute_id: cleanDisputeId,
        dispute_status: targetDisputeStatus,
        dispute_type: disputeType,
        resolution_result: cleanResolutionResult,
        authorization_reference: authorizationReference,
        note: note ? note.trim() : finalReason,
      };

      const inserted = await adminTransactionRepository.insertDisputeEvent(
        client,
        {
          adminId,
          userId: targetUserId,
          action: cleanAction,
          reason: finalReason,
          oldValues: { dispute_status: currentStatus },
          newValues,
        }
      );

      await client.query("COMMIT");

      return {
        dispute_id: cleanDisputeId,
        action: cleanAction,
        dispute_status: targetDisputeStatus,
        resolution_result: cleanResolutionResult,
        created_at: inserted.created_at,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async exportTransactions({
    type,
    status,
    initiated_by,
    anomaly,
    keyword,
    period,
    start_date,
    end_date,
    currentUser,
    now,
  }) {
    const {
      cleanType,
      cleanStatus,
      cleanInitiatedBy,
      cleanAnomaly,
      filterStartDate,
      filterEndDate,
      periodInfo,
    } = parseFilterParams({
      type,
      status,
      initiated_by,
      anomaly,
      period,
      start_date,
      end_date,
      now,
    });

    // Truy xuất an toàn tên Admin xuất báo cáo
    const adminId = currentUser?.user_id || currentUser?.id;
    let adminName = currentUser?.full_name;
    if (!adminName && adminId) {
      const adminUser = await adminTransactionRepository.getUserById(adminId);
      adminName = adminUser?.full_name || "Quản trị viên";
    }
    if (!adminName) {
      adminName = "Quản trị viên";
    }

    // Query tối đa 5001 dòng để kiểm tra trần an toàn (tránh silent truncation)
    const rows = await adminTransactionRepository.getTransactionsForExport({
      type: cleanType,
      status: cleanStatus,
      initiatedBy: cleanInitiatedBy,
      anomaly: cleanAnomaly,
      keyword,
      startDate: filterStartDate,
      endDate: filterEndDate,
      limit: 5001,
    });

    if (rows.length > 5000) {
      const err = httpError(
        422,
        "Số lượng giao dịch thỏa mãn vượt quá giới hạn cho phép (5.000 bản ghi). Vui lòng thu hẹp khoảng thời gian hoặc thêm điều kiện lọc."
      );
      err.code = "EXPORT_LIMIT_EXCEEDED";
      throw err;
    }

    if (rows.length === 0) {
      const err = httpError(
        404,
        "Không có dữ liệu giao dịch nào phù hợp với bộ lọc đã chọn."
      );
      err.code = "NO_DATA_FOUND";
      throw err;
    }

    // Tạo tóm tắt bộ lọc cho Header Excel
    const summaryParts = [];
    if (cleanType !== "ALL") summaryParts.push(`Loại: ${cleanType}`);
    if (cleanStatus !== "ALL") summaryParts.push(`Trạng thái: ${cleanStatus}`);
    if (cleanInitiatedBy !== "ALL") summaryParts.push(`Nguồn: ${cleanInitiatedBy}`);
    if (cleanAnomaly !== "ALL") summaryParts.push(`Cảnh báo: ${cleanAnomaly}`);
    if (keyword && keyword.trim()) summaryParts.push(`Từ khóa: "${keyword.trim()}"`);
    const filterSummary = summaryParts.join(" | ");

    // Tạo file Excel với module transaction.export.js
    const buffer = await buildTransactionsAdminXlsx({
      rows,
      adminName,
      filterSummary,
      startDate: periodInfo.start_date,
      endDate: periodInfo.end_date,
    });

    const fileName = buildExportFileName(
      periodInfo.start_date,
      periodInfo.end_date,
    );

    return { buffer, fileName, totalRows: rows.length };
  },

  computeAdminReversalRequestHash({ adminId, transactionId, reason }) {
    const canonicalPayload = JSON.stringify({
      actor_id: String(adminId),
      operation: "ADMIN_OP_REVERSAL",
      transaction_id: String(transactionId),
      reason: String(reason),
    });
    return crypto.createHash("sha256").update(canonicalPayload).digest("hex");
  },

  async reverseTransaction({
    transactionId,
    adminId,
    reason,
    adminPassword,
    idempotencyKey,
  }) {
    if (!adminId) {
      throw httpError(401, "Thiếu định danh quản trị viên");
    }

    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.trim().length === 0 ||
      idempotencyKey.trim().length > 100
    ) {
      throw httpError(
        400,
        "Header Idempotency-Key là bắt buộc và tối đa 100 ký tự"
      );
    }
    const cleanIdempotencyKey = idempotencyKey.trim();

    if (!transactionId || String(transactionId).trim() === "") {
      throw httpError(400, "Thiếu định danh giao dịch cần hoàn tiền");
    }
    const cleanTxId = String(transactionId).trim();

    if (typeof reason !== "string") {
      throw httpError(
        400,
        "Lý do hoàn tiền (reason) là bắt buộc, từ 5 đến 500 ký tự"
      );
    }
    const cleanReason = reason.trim();
    if (cleanReason.length < 5 || cleanReason.length > 500) {
      throw httpError(
        400,
        "Lý do hoàn tiền (reason) phải có độ dài từ 5 đến 500 ký tự"
      );
    }

    // Xác thực lại mật khẩu Admin trước khi giữ bất kỳ khóa DB nào.
    await adminUserService.verifyAdminStepUpPassword({
      adminId,
      adminPassword,
    });

    const requestHash = this.computeAdminReversalRequestHash({
      adminId,
      transactionId: cleanTxId,
      reason: cleanReason,
    });

    const inserted = await adminUserRepository.tryInsertIdempotencyKey({
      idempotencyKey: cleanIdempotencyKey,
      actorId: adminId,
      actorType: "ADMIN",
      requestPath: ADMIN_REVERSE_REQUEST_PATH,
      requestHash,
    });

    if (!inserted) {
      const existingKey = await adminUserRepository.getIdempotencyKey(
        cleanIdempotencyKey
      );
      if (!existingKey) {
        throw httpError(409, "Yêu cầu hoàn tiền đang được xử lý");
      }

      if (
        String(existingKey.actor_id) !== String(adminId) ||
        existingKey.request_path !== ADMIN_REVERSE_REQUEST_PATH ||
        existingKey.request_hash !== requestHash
      ) {
        throw httpError(
          422,
          "Mã Idempotency-Key đã được sử dụng với dữ liệu hoàn tiền khác"
        );
      }

      if (existingKey.status === "SUCCESS" && existingKey.response_body) {
        return {
          replayed: true,
          data: sanitizeReversalResponseData(existingKey.response_body),
          notificationContext: null,
        };
      }

      const reclaimed = await adminUserRepository.reclaimIdempotencyKey({
        idempotencyKey: cleanIdempotencyKey,
        actorId: adminId,
        requestPath: ADMIN_REVERSE_REQUEST_PATH,
        requestHash,
      });

      if (!reclaimed) {
        const latestKey = await adminUserRepository.getIdempotencyKey(
          cleanIdempotencyKey
        );
        if (
          latestKey &&
          latestKey.status === "SUCCESS" &&
          latestKey.response_body &&
          latestKey.request_hash === requestHash
        ) {
          return {
            replayed: true,
            data: sanitizeReversalResponseData(latestKey.response_body),
            notificationContext: null,
          };
        }
        throw httpError(
          409,
          "Yêu cầu hoàn tiền đang được xử lý, vui lòng không gửi trùng lặp"
        );
      }
    }

    try {
      const txResult = await adminTransactionRepository.executeReversalWithHistory({
        transactionId: cleanTxId,
        adminId,
        reason: cleanReason,
        idempotencyKey: cleanIdempotencyKey,
        requestHash,
        requestPath: ADMIN_REVERSE_REQUEST_PATH,
      });

      return {
        replayed: Boolean(txResult.replayed),
        data: sanitizeReversalResponseData(txResult.responseBody),
        notificationContext: txResult.notificationContext || null,
      };
    } catch (e) {
      try {
        await adminUserRepository.markIdempotencyKeyFailed(cleanIdempotencyKey);
      } catch (markErr) {
        console.error("markIdempotencyKeyFailed error:", markErr.message);
      }
      throw e;
    }
  },
};

module.exports = adminTransactionService;

