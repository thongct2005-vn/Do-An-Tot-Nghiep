const { httpError } = require("../../utils/common/http");

const MIN_POSTPAID_CREDIT_LIMIT = 2000000;
const MIN_AUTO_ADJUSTED_CREDIT_LIMIT = 1000000;

const POSTPAID_LATE_FEE_TIERS = Object.freeze([
  Object.freeze({
    tier: 1,
    key: "late_fee_tier1_bps",
    label: "1–4 ngày",
    minDays: 1,
    maxDays: 4,
    defaultBps: 525,
    limitReductionPercent: 0,
  }),
  Object.freeze({
    tier: 2,
    key: "late_fee_tier2_bps",
    label: "5–9 ngày",
    minDays: 5,
    maxDays: 9,
    defaultBps: 1050,
    limitReductionPercent: 25,
  }),
  Object.freeze({
    tier: 3,
    key: "late_fee_tier3_bps",
    label: "10–13 ngày",
    minDays: 10,
    maxDays: 13,
    defaultBps: 1575,
    limitReductionPercent: 40,
  }),
  Object.freeze({
    tier: 4,
    key: "late_fee_tier4_bps",
    label: "Từ 14 ngày trở lên",
    minDays: 14,
    maxDays: null,
    defaultBps: 2100,
    limitReductionPercent: 50,
  }),
]);

const POSTPAID_CONFIG_FIELD_LABELS = Object.freeze({
  default_credit_limit: "hạn mức mặc định của Ví trả sau",
  min_account_days: "số ngày hoạt động tối thiểu để mở Ví trả sau",
  billing_day: "ngày chốt sao kê Ví trả sau",
  due_day: "ngày đến hạn thanh toán Ví trả sau",
  late_fee_tier1_bps: "tỷ lệ phí chậm trả bậc 1 (1–4 ngày)",
  late_fee_tier2_bps: "tỷ lệ phí chậm trả bậc 2 (5–9 ngày)",
  late_fee_tier3_bps: "tỷ lệ phí chậm trả bậc 3 (10–13 ngày)",
  late_fee_tier4_bps: "tỷ lệ phí chậm trả bậc 4 (từ 14 ngày trở lên)",
  monthly_service_fee: "phí dịch vụ hàng tháng của Ví trả sau",
  free_service_fee_tx_count: "số giao dịch miễn phí dịch vụ ban đầu của Ví trả sau",
});

/**
 * Parses and validates a non-negative integer field in POSTPAID_CONFIG.
 * Preserves runtime validation rules and Vietnamese error messages.
 */
function parseNonNegIntConfig(raw, fieldName) {
  const label = POSTPAID_CONFIG_FIELD_LABELS[fieldName] || "tham số Ví trả sau";
  const val = raw[fieldName];
  const isMissingString = typeof val === "string" && val.trim() === "";
  if (val === undefined || val === null || isMissingString) {
    throw httpError(500, `Hệ thống chưa thiết lập ${label}`);
  }
  const n =
    typeof val === "number"
      ? val
      : typeof val === "string" && /^-?\d+$/.test(val.trim())
        ? Number(val.trim())
        : NaN;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw httpError(500, `Cấu hình ${label} trong hệ thống không hợp lệ`);
  }
  return n;
}

/**
 * Looks up the matching overdue tier specification for a day count.
 */
function resolvePostpaidTierSpec(daysOverdue) {
  const days = Number(daysOverdue);
  if (!Number.isFinite(days) || days < 1) return null;
  for (const spec of POSTPAID_LATE_FEE_TIERS) {
    if (days >= spec.minDays && (spec.maxDays === null || days <= spec.maxDays)) {
      return spec;
    }
  }
  return null;
}

/**
 * Resolves the active late-fee tier descriptor and bps rate for a given overdue day count.
 */
function resolvePostpaidLateFeeTier(daysOverdue, config) {
  const spec = resolvePostpaidTierSpec(daysOverdue);
  if (!spec) return null;
  return {
    tier: spec.tier,
    key: spec.key,
    label: spec.label,
    bps: Number(config[spec.key]),
  };
}

/**
 * Resolves the credit-limit reduction percentage matching the overdue tier.
 */
function resolvePostpaidLimitReductionRule(daysOverdue) {
  const spec = resolvePostpaidTierSpec(daysOverdue);
  if (!spec) return null;
  return {
    tier: spec.tier,
    key: spec.key,
    label: spec.label,
    reductionPercent: Number(spec.limitReductionPercent || 0),
  };
}

/**
 * Normalizes a raw POSTPAID_CONFIG JSONB object read from system_configs.
 * Throws 500 httpError when stored configuration violates runtime invariants.
 */
function normalizePostpaidConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw httpError(500, "Cấu hình Ví trả sau trong hệ thống không hợp lệ");
  }
  if (raw.enabled === undefined || raw.enabled === null) {
    throw httpError(500, "Hệ thống chưa thiết lập trạng thái bật hoặc tắt Ví trả sau");
  }
  if (typeof raw.enabled !== "boolean") {
    throw httpError(500, "Cấu hình trạng thái bật hoặc tắt Ví trả sau không hợp lệ");
  }

  const defaultCreditLimit = parseNonNegIntConfig(raw, "default_credit_limit");
  if (defaultCreditLimit < MIN_POSTPAID_CREDIT_LIMIT) {
    throw httpError(
      500,
      "Cấu hình hạn mức mặc định của Ví trả sau phải tối thiểu 2.000.000đ"
    );
  }

  const billingDay = parseNonNegIntConfig(raw, "billing_day");
  const dueDay = parseNonNegIntConfig(raw, "due_day");
  if (billingDay < 1 || billingDay > 28) {
    throw httpError(500, "Cấu hình ngày chốt sao kê Ví trả sau phải từ ngày 1 đến ngày 28");
  }
  if (dueDay < 1 || dueDay > 28) {
    throw httpError(500, "Cấu hình ngày đến hạn thanh toán Ví trả sau phải từ ngày 1 đến ngày 28");
  }

  const tier1 = parseNonNegIntConfig(raw, "late_fee_tier1_bps");
  const tier2 = parseNonNegIntConfig(raw, "late_fee_tier2_bps");
  const tier3 = parseNonNegIntConfig(raw, "late_fee_tier3_bps");
  const tier4 = parseNonNegIntConfig(raw, "late_fee_tier4_bps");
  if (
    tier1 > 10000 ||
    tier2 > 10000 ||
    tier3 > 10000 ||
    tier4 > 10000 ||
    tier1 > tier2 ||
    tier2 > tier3 ||
    tier3 > tier4
  ) {
    throw httpError(500, "Cấu hình biểu phí chậm trả 4 bậc Ví trả sau không hợp lệ");
  }

  return {
    enabled: raw.enabled,
    default_credit_limit: defaultCreditLimit,
    min_account_days: parseNonNegIntConfig(raw, "min_account_days"),
    billing_day: billingDay,
    due_day: dueDay,
    late_fee_tier1_bps: tier1,
    late_fee_tier2_bps: tier2,
    late_fee_tier3_bps: tier3,
    late_fee_tier4_bps: tier4,
    monthly_service_fee: parseNonNegIntConfig(raw, "monthly_service_fee"),
    free_service_fee_tx_count: parseNonNegIntConfig(raw, "free_service_fee_tx_count"),
  };
}

module.exports = {
  MIN_POSTPAID_CREDIT_LIMIT,
  MIN_AUTO_ADJUSTED_CREDIT_LIMIT,
  POSTPAID_LATE_FEE_TIERS,
  POSTPAID_CONFIG_FIELD_LABELS,
  parseNonNegIntConfig,
  resolvePostpaidLateFeeTier,
  resolvePostpaidLimitReductionRule,
  normalizePostpaidConfig,
};
