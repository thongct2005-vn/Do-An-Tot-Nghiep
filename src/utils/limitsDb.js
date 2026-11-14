const pool = require("../config/database");
const { httpError } = require("./httpError");

// --- Cấu hình & trạng thái cache ---

// Thời gian giữ cache trong RAM (30 giây) để tránh query DB lặp lại mỗi giao dịch
const CACHE_TTL_MS = 30_000;

let policiesCache = { data: null, expiresAt: 0 };
let configsCache = { data: null, expiresAt: 0 };

/**
 * Xóa cache hạn mức & cấu hình (gọi sau khi admin cập nhật DB để áp dụng ngay).
 */
function invalidateLimitsCache() {
  policiesCache = { data: null, expiresAt: 0 };
  configsCache = { data: null, expiresAt: 0 };
}

// --- Đọc & cache dữ liệu từ DB ---

/**
 * Nạp toàn bộ bảng `transaction_limit_policies` từ DB (cache 30s).
 * Không dùng fallback; lỗi DB sẽ ném ra trực tiếp.
 */
async function loadPolicies(db = pool) {
  const now = Date.now();
  if (policiesCache.data && now < policiesCache.expiresAt) {
    return policiesCache.data;
  }

  const res = await db.query(
    `SELECT role, transaction_type, min_amount, max_amount, daily_limit
       FROM transaction_limit_policies`,
  );
  const map = new Map();
  for (const row of res.rows) {
    map.set(`${row.role}:${row.transaction_type}`, {
      min: Number(row.min_amount),
      max: Number(row.max_amount),
      dailyLimit: row.daily_limit == null ? null : Number(row.daily_limit),
    });
  }
  if (map.size > 0) {
    policiesCache = { data: map, expiresAt: now + CACHE_TTL_MS };
  }
  return map;
}

/**
 * Nạp toàn bộ bảng `system_configs` từ DB (cache 30s).
 * Không dùng fallback; lỗi DB sẽ ném ra trực tiếp.
 */
async function loadConfigs(db = pool) {
  const now = Date.now();
  if (configsCache.data && now < configsCache.expiresAt) {
    return configsCache.data;
  }

  const res = await db.query(`SELECT key, value FROM system_configs`);
  const map = new Map();
  for (const row of res.rows) {
    map.set(row.key, row.value);
  }
  if (map.size > 0) {
    configsCache = { data: map, expiresAt: now + CACHE_TTL_MS };
  }
  return map;
}

const SYSTEM_CONFIG_LABELS = {
  HISTORY_PAGE_LIMIT: "số lượng bản ghi mỗi trang lịch sử",
  EXPORT_MAX_ROWS: "giới hạn số dòng xuất dữ liệu",
  USER_FEE_CONFIG: "cấu hình biểu phí người dùng",
  MERCHANT_FEE_CONFIG: "cấu hình biểu phí đối tác",
  RISK_THRESHOLDS: "cấu hình ngưỡng kiểm tra rủi ro",
  DAILY_LIMIT_TIMEZONE: "múi giờ tính hạn mức ngày",
  WALLET_CAPACITY_CONFIG: "cấu hình sức chứa tối đa của ví",
};

const TRANSACTION_TYPE_LABELS = {
  TRANSFER: "chuyển tiền",
  TOPUP: "nạp tiền",
  WITHDRAW: "rút tiền",
  PAYMENT: "thanh toán",
  QR_PAYMENT: "thanh toán QR",
};

const RISK_FLOW_LABELS = {
  LOGIN: "đăng nhập",
  REGISTER: "đăng ký",
  OTP: "xác thực OTP",
  DEFAULT: "mặc định",
};

function describeConfigKey(key) {
  return SYSTEM_CONFIG_LABELS[String(key || "").trim()] || "tham số cấu hình hệ thống";
}

function describeRiskFlow(flowKey) {
  return RISK_FLOW_LABELS[String(flowKey || "").trim().toUpperCase()] || "này";
}

// --- API tra cứu cấu hình & hạn mức ---

/**
 * Lấy giá trị cấu hình hệ thống theo `key` từ bảng `system_configs`.
 * Ném lỗi 500 nếu DB chưa cấu hình `key` này.
 */
async function getSystemConfig(key, db = pool) {
  const configs = await loadConfigs(db);
  if (
    !configs.has(key) ||
    configs.get(key) === undefined ||
    configs.get(key) === null
  ) {
    throw httpError(500, `Hệ thống chưa thiết lập ${describeConfigKey(key)}`);
  }
  return configs.get(key);
}

/**
 * Lấy cấu hình số nguyên dương từ `system_configs`; ném lỗi 500 nếu thiếu hoặc không hợp lệ.
 */
async function getPositiveIntConfig(key, db = pool) {
  const val = Number(await getSystemConfig(key, db));
  if (!Number.isInteger(val) || val <= 0) {
    throw httpError(500, `Giá trị ${describeConfigKey(key)} trong hệ thống không hợp lệ`);
  }
  return val;
}

/**
 * Lấy chính sách hạn mức của hệ thống cho cặp `(role, transactionType)` từ DB.
 * Ném lỗi 500 nếu DB chưa cấu hình cặp này.
 */
async function getTransactionPolicy(role, transactionType, db = pool) {
  const r = role === "MERCHANT" ? "MERCHANT" : "USER";
  const t = String(transactionType || "").trim().toUpperCase();
  if (!t) {
    throw httpError(500, "Thiếu loại giao dịch để tra cứu hạn mức");
  }
  const policies = await loadPolicies(db);
  const policy = policies.get(`${r}:${t}`);
  if (!policy || !Number.isFinite(policy.min) || !Number.isFinite(policy.max)) {
    const roleLabel = r === "MERCHANT" ? "đối tác" : "người dùng";
    const txLabel = TRANSACTION_TYPE_LABELS[t] || "tương ứng";
    throw httpError(
      500,
      `Hệ thống chưa thiết lập hạn mức giao dịch ${txLabel} cho ${roleLabel}`,
    );
  }
  return policy;
}

/**
 * Truy vấn trực tiếp hạn mức riêng của 1 user/merchant (không cache để phản ánh ngay khi admin sửa).
 */
async function getUserCustomLimit(db, userId, transactionType) {
  if (!userId) return null;
  const queryDb = db && typeof db.query === "function" ? db : pool;
  const t = String(transactionType || "").toUpperCase();
  const res = await queryDb.query(
    `SELECT max_amount, daily_limit
       FROM user_transaction_limits
      WHERE user_id = $1 AND transaction_type = $2
      LIMIT 1`,
    [userId, t],
  );
  return res.rows[0] || null;
}

/**
 * Tính hạn mức hiệu lực cuối cùng cho 1 giao dịch của user/merchant:
 * `max` và `dailyLimit` luôn lấy mức chặt hơn (nhỏ hơn) giữa trần hệ thống và hạn mức riêng.
 */
async function getEffectiveTransactionLimit(
  db,
  { userId = null, role = "USER", transactionType },
) {
  const queryDb = db || pool;
  const t = String(transactionType || "").toUpperCase();
  const sys = await getTransactionPolicy(role, t, queryDb);
  const custom = userId ? await getUserCustomLimit(queryDb, userId, t) : null;

  const max =
    custom?.max_amount != null
      ? Math.min(sys.max, Number(custom.max_amount))
      : sys.max;

  let dailyLimit = sys.dailyLimit;
  if (custom?.daily_limit != null) {
    const customDaily = Number(custom.daily_limit);
    // Nếu hệ thống không đặt hạn mức ngày (null) thì áp dụng hạn mức ngày riêng của user
    dailyLimit =
      sys.dailyLimit == null ? customDaily : Math.min(sys.dailyLimit, customDaily);
  }

  return {
    min: sys.min,
    max,
    dailyLimit,
    system: sys,
    custom,
  };
}

/**
 * Lấy sức chứa tối đa hiệu lực của ví cho user/merchant:
 * Mặc định lấy `default_capacity` từ `WALLET_CAPACITY_CONFIG`,
 * nếu user đã cấu hình `WALLET_CAPACITY` trong `user_transaction_limits` thì áp dụng trong khoảng `[min_capacity, max_capacity]`.
 */
async function getEffectiveWalletCapacity(
  db,
  { userId = null, role = "USER" } = {},
) {
  const queryDb = db && typeof db.query === "function" ? db : pool;
  const r = role === "MERCHANT" ? "MERCHANT" : "USER";
  const cfg = await getSystemConfig("WALLET_CAPACITY_CONFIG", queryDb);
  const entry = cfg && typeof cfg === "object" ? cfg[r] : null;
  if (!entry) {
    throw httpError(500, "Hệ thống chưa thiết lập cấu hình sức chứa ví");
  }

  const minCapacity = Number(entry.min_capacity);
  const defaultCapacity = Number(entry.default_capacity);
  const maxCapacity = Number(entry.max_capacity);

  if (
    !Number.isFinite(minCapacity) ||
    !Number.isFinite(defaultCapacity) ||
    !Number.isFinite(maxCapacity) ||
    minCapacity <= 0 ||
    defaultCapacity < minCapacity ||
    maxCapacity < defaultCapacity
  ) {
    throw httpError(500, "Cấu hình sức chứa ví trong hệ thống không hợp lệ");
  }

  const custom = userId
    ? await getUserCustomLimit(queryDb, userId, "WALLET_CAPACITY")
    : null;

  let effectiveCapacity = defaultCapacity;
  let isCustom = false;
  if (custom?.max_amount != null) {
    const customCap = Number(custom.max_amount);
    if (Number.isFinite(customCap) && customCap > 0) {
      effectiveCapacity = Math.min(
        maxCapacity,
        Math.max(minCapacity, customCap),
      );
      isCustom = effectiveCapacity !== defaultCapacity;
    }
  }

  return {
    minCapacity,
    defaultCapacity,
    maxCapacity,
    effectiveCapacity,
    isCustom,
  };
}

/**
 * Đọc ngưỡng đánh giá rủi ro `{ challenge, block }` từ cấu hình `RISK_THRESHOLDS` trong DB.
 * Ném lỗi 500 nếu DB chưa cấu hình `RISK_THRESHOLDS` hoặc thiếu key tương ứng.
 *
 * @param {string|{ key?: string, dryRun?: boolean }} [optionObj] - Tên luồng ("LOGIN", "REGISTER", ...) hoặc object chứa `key`
 */
async function resolveRiskThreshold(optionObj) {
  let key;
  if (typeof optionObj === "string") {
    key = optionObj.trim();
    if (!key) {
      throw httpError(500, "Thiếu tên luồng kiểm tra rủi ro");
    }
  } else if (
    optionObj &&
    typeof optionObj === "object" &&
    typeof optionObj.key === "string"
  ) {
    key = optionObj.key.trim();
    if (!key) {
      throw httpError(500, "Thiếu tên luồng kiểm tra rủi ro");
    }
  } else if (
    optionObj === undefined ||
    optionObj === null ||
    (typeof optionObj === "object" &&
      Object.keys(optionObj).filter((k) => k !== "dryRun").length === 0)
  ) {
    key = "DEFAULT";
  } else {
    throw httpError(500, "Tham số tra cứu ngưỡng kiểm tra rủi ro không hợp lệ");
  }

  const liveMap = await getSystemConfig("RISK_THRESHOLDS", pool);
  const entry = liveMap && typeof liveMap === "object" ? liveMap[key] : null;
  if (
    !entry ||
    entry.challenge === undefined ||
    entry.challenge === null ||
    entry.block === undefined ||
    entry.block === null
  ) {
    throw httpError(
      500,
      `Hệ thống chưa thiết lập ngưỡng kiểm tra rủi ro cho luồng ${describeRiskFlow(key)}`,
    );
  }

  const challenge = Number(entry.challenge);
  const block = Number(entry.block);
  if (!Number.isFinite(challenge) || !Number.isFinite(block)) {
    throw httpError(
      500,
      `Cấu hình ngưỡng kiểm tra rủi ro cho luồng ${describeRiskFlow(key)} không hợp lệ`,
    );
  }

  return { challenge, block };
}

module.exports = {
  invalidateLimitsCache,
  getSystemConfig,
  getPositiveIntConfig,
  getTransactionPolicy,
  getUserCustomLimit,
  getEffectiveTransactionLimit,
  getEffectiveWalletCapacity,
  resolveRiskThreshold,
};
