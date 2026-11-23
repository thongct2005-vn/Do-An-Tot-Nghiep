const { httpError } = require("../common/http");

const ALLOWED_HISTORY_STATUSES = ["SUCCESS", "FAILED", "PENDING"];
const ALLOWED_DIRECTIONS = ["IN", "OUT"];

const TYPE_DIRECTION_ALIASES = {
  TRANSFER_OUT: { type: "TRANSFER", direction: "OUT" },
  TRANSFER_IN: { type: "TRANSFER", direction: "IN" },
  REFUND_OUT: { type: "REFUND", direction: "OUT" },
  REFUND_IN: { type: "REFUND", direction: "IN" },
};

/**
 * Chuẩn hóa bộ lọc loại giao dịch và chiều giao dịch (hỗ trợ TRANSFER_IN / TRANSFER_OUT, REFUND_IN / REFUND_OUT).
 */
function normalizeTypeAndDirection({
  type = null,
  direction = null,
  allowedTypes = ["TRANSFER", "TOPUP", "WITHDRAW", "PAYMENT", "REFUND"],
  allowedDirections = ALLOWED_DIRECTIONS,
} = {}) {
  const rawType =
    type !== undefined && type !== null && String(type).trim()
      ? String(type).trim().toUpperCase()
      : null;

  let normalizedDirection =
    direction !== undefined && direction !== null && String(direction).trim()
      ? String(direction).trim().toUpperCase()
      : null;

  if (normalizedDirection && !allowedDirections.includes(normalizedDirection)) {
    throw httpError(400, "Chiều giao dịch không hợp lệ");
  }

  let normalizedType = rawType;
  const alias = rawType ? TYPE_DIRECTION_ALIASES[rawType] : null;
  if (alias) {
    if (normalizedDirection && normalizedDirection !== alias.direction) {
      throw httpError(400, "Loại giao dịch không khớp với chiều giao dịch");
    }
    normalizedType = alias.type;
    normalizedDirection = alias.direction;
  }

  if (normalizedType && !allowedTypes.includes(normalizedType)) {
    throw httpError(400, "Loại giao dịch không hợp lệ");
  }

  return { type: normalizedType, direction: normalizedDirection };
}

/**
 * Chuẩn hóa trạng thái giao dịch (SUCCESS | FAILED | PENDING).
 */
function normalizeHistoryStatus(status) {
  if (status === undefined || status === null) return null;
  const trimmed = String(status).trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (!ALLOWED_HISTORY_STATUSES.includes(upper)) {
    throw httpError(400, "Trạng thái giao dịch không hợp lệ");
  }
  return upper;
}

/**
 * Parse một mốc số tiền lọc (số nguyên >= 0) hoặc null nếu bỏ trống.
 */
function parseOptionalFilterAmount(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "boolean") {
    throw httpError(400, "Khoảng số tiền lọc không hợp lệ");
  }
  const str = String(raw).trim();
  if (!str) return null;
  if (!/^\d+$/.test(str)) {
    throw httpError(400, "Khoảng số tiền lọc không hợp lệ");
  }
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num < 0) {
    throw httpError(400, "Khoảng số tiền lọc không hợp lệ");
  }
  return num;
}

/**
 * Chuẩn hóa khoảng số tiền (minAmount <= maxAmount).
 */
function normalizeAmountRange(minRaw, maxRaw) {
  const minAmount = parseOptionalFilterAmount(minRaw);
  const maxAmount = parseOptionalFilterAmount(maxRaw);
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    throw httpError(400, "Số tiền tối thiểu phải nhỏ hơn hoặc bằng số tiền tối đa");
  }
  return { minAmount, maxAmount };
}

/**
 * Chuẩn hóa nguồn tiền lọc theo bảng ánh xạ từng kênh (app / merchant).
 */
function normalizeFundingSourceFilter(raw, aliasMap) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  const mapped = aliasMap[upper];
  if (!mapped) {
    throw httpError(400, "Nguồn tiền lọc không hợp lệ");
  }
  return mapped;
}

/**
 * Điều kiện SQL nhận diện các giao dịch hoàn tiền/đảo giao dịch cũ vốn từng lưu
 * transaction_type = 'TRANSFER' trước khi tách riêng loại 'REFUND'.
 */
function buildLegacyRefundPredicateSql(txAlias = "t") {
  return `(
    ${txAlias}.transaction_type = 'TRANSFER'
    AND (
      COALESCE(${txAlias}.fee_rate_snapshot->>'operation_type', '') = 'REVERSAL'
      OR EXISTS (
        SELECT 1
          FROM postpaid_entries pe_r
         WHERE pe_r.tx_id = ${txAlias}.id
           AND pe_r.action = 'REFUND'
      )
    )
  )`;
}

/**
 * Chuẩn hóa transaction_type trả về client/export để hoàn tiền cũ không còn hiện là TRANSFER.
 */
function buildEffectiveTransactionTypeSql(txAlias = "t") {
  return `CASE
    WHEN ${txAlias}.transaction_type = 'REFUND'
      OR ${buildLegacyRefundPredicateSql(txAlias)}
    THEN 'REFUND'::transaction_type_enum
    ELSE ${txAlias}.transaction_type
  END`;
}

/**
 * Biểu thức lọc theo transaction_type chuẩn hóa (tách hoàn tiền khỏi chuyển/nhận tiền).
 */
function buildEffectiveTransactionTypeFilterSql(hasTypeParam, typeParam, txAlias = "t") {
  const legacyRefundSql = buildLegacyRefundPredicateSql(txAlias);
  return `(
    ${hasTypeParam}::boolean = false
    OR (
      CASE (${typeParam}::text)
        WHEN 'REFUND' THEN (
          ${txAlias}.transaction_type = 'REFUND'
          OR ${legacyRefundSql}
        )
        WHEN 'TRANSFER' THEN (
          ${txAlias}.transaction_type = 'TRANSFER'
          AND NOT ${legacyRefundSql}
        )
        ELSE ${txAlias}.transaction_type = (${typeParam}::text)::transaction_type_enum
      END
    )
  )`;
}

module.exports = {
  ALLOWED_HISTORY_STATUSES,
  ALLOWED_DIRECTIONS,
  normalizeTypeAndDirection,
  normalizeHistoryStatus,
  normalizeAmountRange,
  normalizeFundingSourceFilter,
  buildLegacyRefundPredicateSql,
  buildEffectiveTransactionTypeSql,
  buildEffectiveTransactionTypeFilterSql,
};

