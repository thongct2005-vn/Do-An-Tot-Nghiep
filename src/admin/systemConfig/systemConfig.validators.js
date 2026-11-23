const { httpError } = require("../../utils/common/http");
const {
  MIN_POSTPAID_CREDIT_LIMIT,
  POSTPAID_CONFIG_FIELD_LABELS,
  normalizePostpaidConfig,
} = require("../../modules/postpaid/postpaidConfig");

const SYSTEM_CONFIG_KEYS = Object.freeze({
  POSTPAID_CONFIG: "POSTPAID_CONFIG",
});

const ALLOWED_SYSTEM_CONFIG_KEYS = Object.freeze(
  Object.values(SYSTEM_CONFIG_KEYS)
);

const POSTPAID_CONFIG_FIELDS = Object.freeze([
  "enabled",
  "default_credit_limit",
  "min_account_days",
  "billing_day",
  "due_day",
  "late_fee_tier1_bps",
  "late_fee_tier2_bps",
  "late_fee_tier3_bps",
  "late_fee_tier4_bps",
  "monthly_service_fee",
  "free_service_fee_tx_count",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates that key equals the supported POSTPAID_CONFIG system configuration key.
 */
function assertAllowedSystemConfigKey(key) {
  if (typeof key !== "string" || !ALLOWED_SYSTEM_CONFIG_KEYS.includes(key)) {
    throw httpError(
      400,
      `Khóa cấu hình '${String(key || "")}' không được hỗ trợ`
    );
  }
  return key;
}

function assertExactKeys(obj, requiredKeys, contextLabel, statusCode = 400) {
  const actualKeys = Object.keys(obj);
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      throw httpError(
        statusCode,
        `${contextLabel}: thiếu trường bắt buộc '${key}'`
      );
    }
  }
  for (const key of actualKeys) {
    if (!requiredKeys.includes(key)) {
      throw httpError(statusCode, `${contextLabel}: khóa không hợp lệ '${key}'`);
    }
  }
}

function parseIntField(
  value,
  fieldLabel,
  { min = 0, max = Number.MAX_SAFE_INTEGER, statusCode = 400 } = {}
) {
  if (value === undefined || value === null || typeof value === "boolean") {
    throw httpError(
      statusCode,
      `${fieldLabel} không hợp lệ hoặc đang bị bỏ trống`
    );
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;

  if (!Number.isSafeInteger(parsed)) {
    throw httpError(statusCode, `${fieldLabel} phải là số nguyên hợp lệ`);
  }
  if (parsed < min || parsed > max) {
    if (max === Number.MAX_SAFE_INTEGER) {
      throw httpError(statusCode, `${fieldLabel} phải >= ${min}`);
    }
    throw httpError(
      statusCode,
      `${fieldLabel} phải nằm trong khoảng ${min}..${max}`
    );
  }
  return parsed;
}

function validateAndNormalizePostpaidConfig(raw) {
  if (!isPlainObject(raw)) {
    throw httpError(400, "POSTPAID_CONFIG phải là đối tượng JSON hợp lệ");
  }
  assertExactKeys(raw, POSTPAID_CONFIG_FIELDS, "POSTPAID_CONFIG", 400);

  if (typeof raw.enabled !== "boolean") {
    throw httpError(
      400,
      "POSTPAID_CONFIG.enabled phải là kiểu boolean (true/false)"
    );
  }

  const parsePostpaidInt = (field, opts = {}) =>
    parseIntField(
      raw[field],
      `POSTPAID_CONFIG.${field} (${POSTPAID_CONFIG_FIELD_LABELS[field] || field})`,
      { min: 0, statusCode: 400, ...opts }
    );

  const tier1 = parsePostpaidInt("late_fee_tier1_bps", { min: 0, max: 10000 });
  const tier2 = parsePostpaidInt("late_fee_tier2_bps", { min: 0, max: 10000 });
  const tier3 = parsePostpaidInt("late_fee_tier3_bps", { min: 0, max: 10000 });
  const tier4 = parsePostpaidInt("late_fee_tier4_bps", { min: 0, max: 10000 });
  if (tier1 > tier2 || tier2 > tier3 || tier3 > tier4) {
    throw httpError(
      400,
      "Tỷ lệ phí chậm trả các bậc phải tăng dần không giảm (Bậc 1 <= Bậc 2 <= Bậc 3 <= Bậc 4)"
    );
  }

  return {
    enabled: raw.enabled,
    default_credit_limit: parsePostpaidInt("default_credit_limit", {
      min: MIN_POSTPAID_CREDIT_LIMIT,
    }),
    min_account_days: parsePostpaidInt("min_account_days"),
    billing_day: parsePostpaidInt("billing_day", { min: 1, max: 28 }),
    due_day: parsePostpaidInt("due_day", { min: 1, max: 28 }),
    late_fee_tier1_bps: tier1,
    late_fee_tier2_bps: tier2,
    late_fee_tier3_bps: tier3,
    late_fee_tier4_bps: tier4,
    monthly_service_fee: parsePostpaidInt("monthly_service_fee"),
    free_service_fee_tx_count: parsePostpaidInt("free_service_fee_tx_count"),
  };
}

/**
 * Validates and normalizes an incoming admin config payload for POSTPAID_CONFIG.
 */
function validateSystemConfigInput(key, rawValue) {
  assertAllowedSystemConfigKey(key);
  return validateAndNormalizePostpaidConfig(rawValue);
}

/**
 * Normalizes a stored POSTPAID_CONFIG JSONB value read from PostgreSQL.
 */
function normalizeStoredSystemConfig(key, rawValue) {
  assertAllowedSystemConfigKey(key);
  return normalizePostpaidConfig(rawValue);
}

function collectLeafDiffs(oldNode, newNode, prefix, outChanges) {
  if (isPlainObject(newNode)) {
    const oldObj = isPlainObject(oldNode) ? oldNode : {};
    for (const childKey of Object.keys(newNode)) {
      const nextPath = prefix ? `${prefix}.${childKey}` : childKey;
      collectLeafDiffs(oldObj[childKey], newNode[childKey], nextPath, outChanges);
    }
    return;
  }
  const normalizedOld = oldNode === undefined ? null : oldNode;
  if (normalizedOld !== newNode) {
    outChanges.push({
      path: prefix,
      old_value: normalizedOld,
      new_value: newNode,
    });
  }
}

/**
 * Computes deterministic leaf-level differences between two normalized config objects.
 */
function buildConfigDiff(oldConfig, newConfig) {
  const changes = [];
  collectLeafDiffs(oldConfig || {}, newConfig || {}, "", changes);
  return {
    has_changes: changes.length > 0,
    changed_count: changes.length,
    changes,
  };
}

module.exports = {
  SYSTEM_CONFIG_KEYS,
  ALLOWED_SYSTEM_CONFIG_KEYS,
  POSTPAID_CONFIG_FIELDS,
  assertAllowedSystemConfigKey,
  validateSystemConfigInput,
  normalizeStoredSystemConfig,
  buildConfigDiff,
};
