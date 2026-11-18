const { httpError } = require("./httpError");

const ALLOWED_HISTORY_STATUSES = ["SUCCESS", "FAILED", "PENDING"];
const ALLOWED_DIRECTIONS = ["IN", "OUT"];

/**
 * Chuẩn hóa bộ lọc loại giao dịch và chiều giao dịch (hỗ trợ TRANSFER_IN / TRANSFER_OUT).
 */
function normalizeTypeAndDirection({
  type = null,
  direction = null,
  allowedTypes = ["TRANSFER", "TOPUP", "WITHDRAW", "PAYMENT"],
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
  if (rawType === "TRANSFER_OUT" || rawType === "TRANSFER_IN") {
    const impliedDirection = rawType === "TRANSFER_OUT" ? "OUT" : "IN";
    if (normalizedDirection && normalizedDirection !== impliedDirection) {
      throw httpError(400, "Loại giao dịch không khớp với chiều giao dịch");
    }
    normalizedType = "TRANSFER";
    normalizedDirection = impliedDirection;
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

module.exports = {
  ALLOWED_HISTORY_STATUSES,
  ALLOWED_DIRECTIONS,
  normalizeTypeAndDirection,
  normalizeHistoryStatus,
  normalizeAmountRange,
  normalizeFundingSourceFilter,
};

