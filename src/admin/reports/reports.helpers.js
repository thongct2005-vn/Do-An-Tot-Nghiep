// reports.helpers.js: Hàm chuẩn hóa và validate tham số lọc báo cáo Admin và xử lý fallback thiếu bảng rollup.
const { httpError } = require("../../utils/common/http");
const { resolveAdminDateRange } = require("../../utils/common/dateRange");
const { isMissingRelationError } = require("./reportRollup");

function filters(input = {}) {
  for (const key of [
    "start_date",
    "end_date",
    "merchant_id",
    "transaction_type",
    "group_by",
    "role",
    "scope",
  ]) {
    if (input[key] !== undefined && typeof input[key] !== "string") {
      throw httpError(400, `${key} không hợp lệ`);
    }
  }
  const range = resolveAdminDateRange(input.start_date, input.end_date);
  const group = input.group_by || "day";
  if (!["day", "week", "month", "quarter", "year"].includes(group)) {
    throw httpError(400, "group_by không hợp lệ");
  }
  const merchant = input.merchant_id || null;
  if (
    merchant &&
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(merchant)
  ) {
    throw httpError(400, "merchant_id không hợp lệ");
  }
  const type = input.transaction_type || "ALL";
  if (!["ALL", "PAYMENT", "TRANSFER"].includes(type)) {
    throw httpError(400, "transaction_type không hợp lệ");
  }
  const role = input.role || "ALL";
  if (!["ALL", "USER", "MERCHANT"].includes(role)) {
    throw httpError(400, "role không hợp lệ");
  }
  const scope = input.scope || "full";
  if (!["full", "kpi", "merchants"].includes(scope)) {
    throw httpError(400, "scope không hợp lệ");
  }
  const page = Number(input.page ?? 1);
  const limit = Number(input.limit ?? 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw httpError(400, "Phân trang không hợp lệ");
  }
  return {
    ...range,
    group,
    merchant,
    type: type === "ALL" ? null : type,
    role,
    scope,
    page,
    limit,
    period: { ...range.period, group_by: group },
  };
}

async function with42P01Fallback(rollupUntil, rollupRunner, fallbackRunner) {
  if (!rollupUntil) {
    return fallbackRunner();
  }
  try {
    return await rollupRunner(rollupUntil);
  } catch (err) {
    if (isMissingRelationError(err)) {
      return fallbackRunner();
    }
    throw err;
  }
}

module.exports = {
  filters,
  with42P01Fallback,
};

