const pool = require("../../config/database");
const { httpError } = require("../common/http");

// --- Cấu hình & trạng thái cache ---

// Thời gian giữ cache trong RAM (30 giây) để tránh query DB lặp lại mỗi giao dịch
const CACHE_TTL_MS = 30_000;

let configsCache = { data: null, expiresAt: 0 };

/**
 * Xóa cache cấu hình & hạn mức (gọi sau khi admin cập nhật DB để áp dụng ngay).
 */
function invalidateLimitsCache() {
  configsCache = { data: null, expiresAt: 0 };
}

// --- Đọc & cache dữ liệu từ DB ---

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
  TRANSACTION_LIMIT_CONFIG: "cấu hình hạn mức giao dịch hệ thống",
  POSTPAID_CONFIG: "cấu hình Ví trả sau",
  POSTPAID_REMINDER_CONFIG: "cấu hình nhắc nợ Ví trả sau",
  POSTPAID_STATUS: "danh mục trạng thái Ví trả sau",
  POSTPAID_ENTRY_ACTIONS: "danh mục loại biến động Ví trả sau",
};

const TRANSACTION_TYPE_LABELS = {
  TRANSFER: "chuyển tiền",
  TOPUP: "nạp tiền",
  WITHDRAW: "rút tiền",
  PAYMENT: "thanh toán",
  QR_PAYMENT: "thanh toán QR",
  SANDBOX_TOPUP: "nạp tiền thử nghiệm",
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
 * Lấy chính sách hạn mức của hệ thống cho cặp `(role, transactionType)` từ `system_configs["TRANSACTION_LIMIT_CONFIG"]`.
 * Ném lỗi 500 nếu DB chưa cấu hình hoặc dữ liệu không hợp lệ.
 */
async function getTransactionPolicy(role, transactionType, db = pool) {
  const r = role === "MERCHANT" ? "MERCHANT" : "USER";
  const t = String(transactionType || "").trim().toUpperCase();
  if (!t) {
    throw httpError(500, "Thiếu loại giao dịch để tra cứu hạn mức");
  }

  const cfg = await getSystemConfig("TRANSACTION_LIMIT_CONFIG", db);
  const rolePolicies =
    cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg[r] : null;
  const rawPolicy =
    rolePolicies && typeof rolePolicies === "object" && !Array.isArray(rolePolicies)
      ? rolePolicies[t]
      : null;

  const roleLabel = r === "MERCHANT" ? "đối tác" : "người dùng";
  const txLabel = TRANSACTION_TYPE_LABELS[t] || "tương ứng";

  if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
    throw httpError(
      500,
      `Hệ thống chưa thiết lập hạn mức giao dịch ${txLabel} cho ${roleLabel}`,
    );
  }

  const min = Number(rawPolicy.min_amount);
  const max = Number(rawPolicy.max_amount);
  const dailyLimit =
    rawPolicy.daily_limit === null || rawPolicy.daily_limit === undefined
      ? null
      : Number(rawPolicy.daily_limit);

  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min <= 0 ||
    max < min ||
    (dailyLimit !== null && (!Number.isSafeInteger(dailyLimit) || dailyLimit <= 0))
  ) {
    throw httpError(
      500,
      `Cấu hình hạn mức giao dịch ${txLabel} cho ${roleLabel} không hợp lệ`,
    );
  }

  return { min, max, dailyLimit };
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
