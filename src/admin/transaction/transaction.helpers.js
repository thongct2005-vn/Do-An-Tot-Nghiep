// transaction.helpers.js: Hằng số bộ lọc, tra soát, phân tích toàn vẹn số dư và điều kiện hoàn tiền giao dịch Admin.
const { httpError } = require("../../utils/common/http");
const {
  resolveAdminDateRange,
  getCurrentMonthBoundsInVietnam,
  getMondayOfDateStr,
} = require("../../utils/common/dateRange");

const ADMIN_REVERSE_REQUEST_PATH =
  "POST /api/v2/admin/transactions/:id/reverse";
const REVERSE_BODY_ALLOWLIST = new Set(["reason", "admin_password"]);

const VALID_TRANSACTION_TYPES = [
  "ALL",
  "TRANSFER",
  "TOPUP",
  "WITHDRAW",
  "PAYMENT",
  "REFUND",
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

function sanitizeReversalResponseData(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const copy = { ...raw };
  delete copy.admin_password;
  return copy;
}

function evaluatePostpaidRefundEligibility({
  tx,
  postpaidSummary,
  alreadyReversed = false,
  reversalEligibility = null,
}) {
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

  if (alreadyReversed) {
    eligible = false;
    code = "TRANSACTION_ALREADY_REVERSED";
    reason = "Giao dịch này đã được hoàn tiền trước đó";
  } else if (tx.status !== "SUCCESS" || tx.transaction_type !== "PAYMENT") {
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
  } else if (reversalEligibility && !reversalEligibility.eligible) {
    eligible = false;
    code = reversalEligibility.code;
    reason = reversalEligibility.reason;
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

function evaluateReversalEligibility({
  tx,
  alreadyReversed,
  reversalInfo,
  postpaidSummary = null,
}) {
  if (!tx) {
    return {
      eligible: false,
      code: "NOT_FOUND",
      reason: "Không tìm thấy giao dịch",
      funding_source: null,
      refund_amount: 0,
    };
  }

  const isPostpaid = Boolean(postpaidSummary);
  const fundingSource =
    tx.transaction_type === "PAYMENT"
      ? isPostpaid
        ? "POSTPAID"
        : tx.linked_bank_account_id
          ? "BANK"
          : "MAIN_WALLET"
      : null;
  const originalAmount = Number(tx.amount || 0);
  const refundedAmount = isPostpaid
    ? Number(postpaidSummary.refunded_total || 0)
    : 0;
  const refundAmount =
    tx.transaction_type === "PAYMENT"
      ? isPostpaid
        ? Math.max(0, originalAmount - refundedAmount)
        : originalAmount
      : 0;

  if (tx.transaction_type !== "PAYMENT") {
    return {
      eligible: false,
      code: "REVERSAL_UNSUPPORTED_TYPE",
      reason: "Chỉ hỗ trợ hoàn tiền cho giao dịch thanh toán Merchant (PAYMENT)",
      funding_source: null,
      refund_amount: 0,
    };
  }
  if (tx.status !== "SUCCESS") {
    return {
      eligible: false,
      code: "REVERSAL_TX_NOT_SUCCESS",
      reason: "Chỉ được hoàn tiền giao dịch ở trạng thái Thành công (SUCCESS)",
      funding_source: fundingSource,
      refund_amount: refundAmount,
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
      funding_source: fundingSource,
      refund_amount: refundAmount,
    };
  }
  if (alreadyReversed || reversalInfo?.direction === "ORIGINAL_REVERSED") {
    return {
      eligible: false,
      code: "TRANSACTION_ALREADY_REVERSED",
      reason: "Giao dịch này đã được hoàn tiền trước đó",
      funding_source: fundingSource,
      refund_amount: refundAmount,
    };
  }
  if (!tx.destination_user_id) {
    return {
      eligible: false,
      code: "REVERSAL_INVALID_WALLETS",
      reason:
        "Giao dịch thanh toán không có tài khoản cửa hàng Merchant nhận tiền hợp lệ",
      funding_source: fundingSource,
      refund_amount: refundAmount,
    };
  }
  if (tx.destination_user_role !== "MERCHANT") {
    return {
      eligible: false,
      code: "REVERSAL_MERCHANT_ONLY",
      reason: "Chỉ hỗ trợ hoàn tiền cho giao dịch thanh toán tại cửa hàng Merchant",
      funding_source: fundingSource,
      refund_amount: refundAmount,
    };
  }

  const realBuyerId = isPostpaid
    ? postpaidSummary.buyer_user_id
    : tx.source_user_id;
  const realBuyerRole = isPostpaid
    ? postpaidSummary.buyer_user_role
    : tx.source_user_role;
  const realBuyerStatus = isPostpaid
    ? postpaidSummary.buyer_user_status
    : tx.source_user_status;

  if (
    !realBuyerId ||
    String(realBuyerId) === String(tx.destination_user_id) ||
    realBuyerRole === "SYSTEM"
  ) {
    return {
      eligible: false,
      code: "REVERSAL_INVALID_WALLETS",
      reason:
        "Giao dịch không có cặp tài khoản khách hàng và cửa hàng Merchant hợp lệ khác nhau",
      funding_source: fundingSource,
      refund_amount: refundAmount,
    };
  }
  if (isPostpaid && refundAmount <= 0) {
    return {
      eligible: false,
      code: "POSTPAID_ALREADY_FULLY_REFUNDED",
      reason: "Giao dịch Ví trả sau này đã được hoàn đủ trước đó",
      funding_source: fundingSource,
      refund_amount: 0,
    };
  }
  if (
    (realBuyerStatus && realBuyerStatus !== "ACTIVE") ||
    (tx.destination_user_status && tx.destination_user_status !== "ACTIVE")
  ) {
    return {
      eligible: false,
      code: "REVERSAL_ACCOUNT_NOT_ACTIVE",
      reason:
        "Cả tài khoản khách hàng và ví Merchant đều phải đang ở trạng thái hoạt động (ACTIVE)",
      funding_source: fundingSource,
      refund_amount: refundAmount,
    };
  }
  if (
    tx.destination_user_balance !== undefined &&
    tx.destination_user_balance !== null &&
    Number(tx.destination_user_balance) < refundAmount
  ) {
    return {
      eligible: false,
      code: "REVERSAL_INSUFFICIENT_BALANCE",
      reason:
        "Ví Merchant hiện không đủ số dư để thực hiện hoàn tiền 100% giá trị giao dịch",
      funding_source: fundingSource,
      refund_amount: refundAmount,
    };
  }
  return {
    eligible: true,
    code: null,
    reason: null,
    funding_source: fundingSource,
    refund_amount: refundAmount,
  };
}

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
      `Loại giao dịch không hợp lệ. Chỉ chấp nhận: ${VALID_TRANSACTION_TYPES.join(", ")}`,
    );
  }

  const cleanStatus = status ? status.trim().toUpperCase() : "ALL";
  if (!VALID_TRANSACTION_STATUSES.includes(cleanStatus)) {
    throw httpError(
      400,
      `Trạng thái giao dịch không hợp lệ. Chỉ chấp nhận: ${VALID_TRANSACTION_STATUSES.join(", ")}`,
    );
  }

  const cleanInitiatedBy = initiated_by
    ? initiated_by.trim().toUpperCase()
    : "ALL";
  if (!VALID_INITIATED_BY.includes(cleanInitiatedBy)) {
    throw httpError(
      400,
      `Nguồn thực hiện không hợp lệ. Chỉ chấp nhận: ${VALID_INITIATED_BY.join(", ")}`,
    );
  }

  const cleanAnomaly = anomaly ? anomaly.trim().toUpperCase() : "ALL";
  if (!VALID_ANOMALIES.includes(cleanAnomaly)) {
    throw httpError(
      400,
      `Cảnh báo bất thường không hợp lệ. Chỉ chấp nhận: ${VALID_ANOMALIES.join(", ")}`,
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
      t.transaction_type === "REFUND" ||
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
          message:
            "Giao dịch thiếu dữ liệu ảnh chụp số dư (snapshot) bắt buộc",
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
            message:
              "Số dư ví sau nạp tiền không khớp với số tiền giao dịch",
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

function resolveAdminNetAmount({ transactionType, amount, merchantFee }) {
  const type = String(transactionType || "").toUpperCase();
  if (type === "PAYMENT" || type === "TRANSFER" || type === "REFUND") {
    return Math.max(0, amount - merchantFee);
  }
  return amount;
}

const POSTPAID_REPAY_ACTIONS = new Set([
  "REPAY_PRINCIPAL",
  "REPAY_SERVICE_FEE",
  "REPAY_LATE_FEE",
]);

function resolveAdminFundingContext(tx, postpaidSummary = null) {
  const snapshot =
    tx?.fee_rate_snapshot && typeof tx.fee_rate_snapshot === "object"
      ? tx.fee_rate_snapshot
      : null;
  const txType = String(tx?.transaction_type || "").toUpperCase();
  const snapshotFunding = snapshot?.funding_source
    ? String(snapshot.funding_source).trim().toUpperCase()
    : null;
  const snapshotOriginalFunding = snapshot?.original_funding_source
    ? String(snapshot.original_funding_source).trim().toUpperCase()
    : null;
  const snapshotAction = snapshot?.postpaid_action
    ? String(snapshot.postpaid_action).trim().toUpperCase()
    : null;
  const snapshotLeg = snapshot?.postpaid_leg
    ? String(snapshot.postpaid_leg).trim().toUpperCase()
    : null;
  const entryAction = tx?.postpaid_entry_action
    ? String(tx.postpaid_entry_action).trim().toUpperCase()
    : null;
  const isSourcePostpaidWallet =
    tx?.source_user_name === "SYSTEM_POSTPAID_WALLET" ||
    tx?.source_user_phone === "SYS_BNPL_1";
  const isDestPostpaidWallet =
    tx?.destination_user_name === "SYSTEM_POSTPAID_WALLET" ||
    tx?.destination_user_phone === "SYS_BNPL_1";
  const isReversal =
    txType === "REFUND" ||
    String(snapshot?.operation_type || "").trim().toUpperCase() === "REVERSAL" ||
    tx?.admin_action === "ADMIN_OP_REVERSAL";

  const isPostpaid = Boolean(
    entryAction ||
      postpaidSummary ||
      snapshotFunding === "POSTPAID" ||
      snapshotOriginalFunding === "POSTPAID" ||
      isSourcePostpaidWallet ||
      isDestPostpaidWallet,
  );

  const funding_source = isPostpaid
    ? "POSTPAID"
    : tx?.linked_bank_account_id || snapshotFunding === "BANK"
      ? "BANK"
      : "MAIN_WALLET";

  let postpaid_action = null;
  if (isPostpaid) {
    postpaid_action =
      snapshotAction ||
      entryAction ||
      (postpaidSummary ? "PURCHASE" : null) ||
      (snapshotOriginalFunding === "POSTPAID" || isReversal ? "REFUND" : null) ||
      (isDestPostpaidWallet && txType === "PAYMENT" ? "REPAY_PRINCIPAL" : null) ||
      (isSourcePostpaidWallet && txType === "PAYMENT" ? "PURCHASE" : null);
  }

  let postpaid_leg = null;
  if (isPostpaid) {
    postpaid_leg =
      snapshotLeg ||
      (postpaid_action === "REFUND" && isDestPostpaidWallet
        ? "DEBT_RESTORATION"
        : null);
  }

  const shouldIncludePostpaidBuyer =
    postpaid_action === "PURCHASE" ||
    (postpaid_action === "REFUND" && postpaid_leg === "DEBT_RESTORATION");

  const buyerId = shouldIncludePostpaidBuyer
    ? postpaidSummary?.buyer_user_id || tx?.postpaid_buyer_id || null
    : null;
  const buyerName = shouldIncludePostpaidBuyer
    ? postpaidSummary?.buyer_name || tx?.postpaid_buyer_name || null
    : null;
  const buyerPhone = shouldIncludePostpaidBuyer
    ? postpaidSummary?.buyer_phone || tx?.postpaid_buyer_phone || ""
    : "";

  const postpaid_buyer = buyerId
    ? {
        id: String(buyerId),
        full_name: buyerName || "Chưa cập nhật",
        phone: buyerPhone || "",
      }
    : null;

  return {
    funding_source,
    postpaid_action,
    postpaid_leg,
    postpaid_buyer,
  };
}

module.exports = {
  ADMIN_REVERSE_REQUEST_PATH,
  REVERSE_BODY_ALLOWLIST,
  VALID_TRANSACTION_TYPES,
  VALID_TRANSACTION_STATUSES,
  VALID_INITIATED_BY,
  VALID_ANOMALIES,
  VALID_DISPUTE_TYPES,
  VALID_RESOLUTION_RESULTS,
  POSTPAID_REPAY_ACTIONS,
  sanitizeReversalResponseData,
  evaluatePostpaidRefundEligibility,
  evaluateReversalEligibility,
  parseDateRange,
  parseFilterParams,
  calculateIntegrityAndAnomalies,
  resolveAdminNetAmount,
  resolveAdminFundingContext,
};

