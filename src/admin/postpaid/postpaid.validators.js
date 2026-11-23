const { httpError } = require("../../utils/common/http");
const { MIN_POSTPAID_CREDIT_LIMIT } = require("../../modules/postpaid/postpaidConfig");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CYCLE_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_WALLET_STATUSES = Object.freeze(["ACTIVE", "PAST_DUE", "FROZEN", "INACTIVE"]);
const VALID_LOCK_REASONS = Object.freeze(["USER_FREEZE", "ADMIN_FREEZE", "OVERDUE_REPEAT"]);
const VALID_ENTRY_ACTIONS = Object.freeze([
  "PURCHASE",
  "REPAY_PRINCIPAL",
  "REPAY_SERVICE_FEE",
  "REPAY_LATE_FEE",
  "SERVICE_FEE",
  "LATE_FEE",
  "REFUND",
  "STATEMENT_CLOSE",
  "LIMIT_ADJUST",
]);
const VALID_UNLOCK_STATUSES = Object.freeze(["PENDING", "APPROVED", "REJECTED"]);

function assertValidUuid(value, label = "Định danh") {
  const clean = String(value || "").trim();
  if (!UUID_RE.test(clean)) {
    throw httpError(400, `${label} không đúng định dạng UUID`);
  }
  return clean;
}

function parseAdminReason(rawReason, label = "Lý do thao tác") {
  if (typeof rawReason !== "string") {
    throw httpError(400, `Vui lòng nhập ${label.toLowerCase()}`);
  }
  const clean = rawReason.trim();
  if (clean.length < 5 || clean.length > 500) {
    throw httpError(400, `${label} phải từ 5 đến 500 ký tự`);
  }
  return clean;
}

function parsePagination(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const rawLimit = query.limit;
  const rawOffset = query.offset;
  const parsedLimit = rawLimit === undefined || rawLimit === "" ? defaultLimit : Number.parseInt(rawLimit, 10);
  const parsedOffset = rawOffset === undefined || rawOffset === "" ? 0 : Number.parseInt(rawOffset, 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > maxLimit) {
    throw httpError(400, `limit phải nằm trong khoảng 1..${maxLimit}`);
  }
  if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
    throw httpError(400, "offset phải là số nguyên >= 0");
  }
  return { limit: parsedLimit, offset: parsedOffset };
}

function parseWalletListFilters(query = {}) {
  const { limit, offset } = parsePagination(query);
  const rawStatus = String(query.status || "ALL").trim().toUpperCase();
  if (rawStatus !== "ALL" && !VALID_WALLET_STATUSES.includes(rawStatus)) {
    throw httpError(400, "Trạng thái ví lọc không hợp lệ");
  }

  const rawLockReason = String(query.lock_reason || "ALL").trim().toUpperCase();
  if (rawLockReason !== "ALL" && !VALID_LOCK_REASONS.includes(rawLockReason)) {
    throw httpError(400, "Lý do khóa lọc không hợp lệ");
  }

  const rawSortBy = String(query.sort_by || "updated_at").trim().toLowerCase();
  const sortBy = ["used_amount", "credit_limit", "due_date", "updated_at"].includes(rawSortBy)
    ? rawSortBy
    : "updated_at";
  const sortDir = String(query.sort_dir || "desc").trim().toLowerCase() === "asc" ? "ASC" : "DESC";
  const search = typeof query.search === "string" && query.search.trim() ? query.search.trim() : null;

  return {
    limit,
    offset,
    status: rawStatus === "ALL" ? null : rawStatus,
    lockReason: rawLockReason === "ALL" ? null : rawLockReason,
    sortBy,
    sortDir,
    search,
  };
}

function parseEntryListFilters(query = {}) {
  const { limit, offset } = parsePagination(query, { defaultLimit: 25, maxLimit: 100 });
  const rawAction = String(query.action || "ALL").trim().toUpperCase();
  if (rawAction !== "ALL" && !VALID_ENTRY_ACTIONS.includes(rawAction)) {
    throw httpError(400, "Loại biến động lọc không hợp lệ");
  }

  const userId = query.user_id && String(query.user_id).trim()
    ? assertValidUuid(query.user_id, "user_id")
    : null;

  let cycleMonth = null;
  if (query.cycle_month && String(query.cycle_month).trim()) {
    const cleanCycle = String(query.cycle_month).trim();
    if (!CYCLE_MONTH_RE.test(cleanCycle)) {
      throw httpError(400, "cycle_month phải có định dạng YYYY-MM");
    }
    cycleMonth = cleanCycle;
  }

  let startDate = null;
  let endDate = null;
  if (query.start_date && String(query.start_date).trim()) {
    const cleanStart = String(query.start_date).trim();
    if (!YMD_RE.test(cleanStart)) {
      throw httpError(400, "start_date phải có định dạng YYYY-MM-DD");
    }
    startDate = cleanStart;
  }
  if (query.end_date && String(query.end_date).trim()) {
    const cleanEnd = String(query.end_date).trim();
    if (!YMD_RE.test(cleanEnd)) {
      throw httpError(400, "end_date phải có định dạng YYYY-MM-DD");
    }
    endDate = cleanEnd;
  }
  if (startDate && endDate && startDate > endDate) {
    throw httpError(400, "start_date không được lớn hơn end_date");
  }

  const search = typeof query.search === "string" && query.search.trim() ? query.search.trim() : null;

  return {
    limit,
    offset,
    action: rawAction === "ALL" ? null : rawAction,
    userId,
    cycleMonth,
    startDate,
    endDate,
    search,
  };
}

function parseUnlockRequestFilters(query = {}) {
  const { limit, offset } = parsePagination(query);
  const rawStatus = String(query.status || "PENDING").trim().toUpperCase();
  if (rawStatus !== "ALL" && !VALID_UNLOCK_STATUSES.includes(rawStatus)) {
    throw httpError(400, "Trạng thái hồ sơ mở khóa lọc không hợp lệ");
  }
  const search = typeof query.search === "string" && query.search.trim() ? query.search.trim() : null;
  return {
    limit,
    offset,
    status: rawStatus === "ALL" ? null : rawStatus,
    search,
  };
}

function parseLimitAdjustPayload(body = {}) {
  const rawLimit = body?.credit_limit;
  if (rawLimit === undefined || rawLimit === null || typeof rawLimit === "boolean") {
    throw httpError(400, "Vui lòng nhập hạn mức Ví trả sau mới hợp lệ");
  }
  const parsed =
    typeof rawLimit === "number"
      ? rawLimit
      : typeof rawLimit === "string" && /^-?\d+$/.test(rawLimit.trim())
        ? Number(rawLimit.trim())
        : NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw httpError(400, "Hạn mức Ví trả sau phải là số nguyên hợp lệ");
  }
  if (parsed < MIN_POSTPAID_CREDIT_LIMIT) {
    throw httpError(
      400,
      "Hạn mức Ví trả sau do Quản trị viên điều chỉnh phải tối thiểu 2.000.000đ"
    );
  }
  const reason = parseAdminReason(body?.reason, "Lý do điều chỉnh hạn mức");
  return { creditLimit: parsed, reason };
}

function parseProofIndex(rawIndex) {
  const str = String(rawIndex ?? "").trim();
  if (!/^\d+$/.test(str)) {
    throw httpError(400, "Chỉ số ảnh chứng minh thu nhập không hợp lệ");
  }
  const idx = Number.parseInt(str, 10);
  if (idx < 0 || idx > 2) {
    throw httpError(400, "Chỉ số ảnh chứng minh thu nhập phải từ 0 đến 2");
  }
  return idx;
}

module.exports = {
  assertValidUuid,
  parseAdminReason,
  parsePagination,
  parseWalletListFilters,
  parseEntryListFilters,
  parseUnlockRequestFilters,
  parseLimitAdjustPayload,
  parseProofIndex,
};
