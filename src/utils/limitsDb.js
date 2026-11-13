const pool = require("../config/database");
const fallbackLimits = require("../config/limits");

const CACHE_TTL_MS = 30_000;

let policiesCache = { data: null, expiresAt: 0 };
let configsCache = { data: null, expiresAt: 0 };

const FALLBACK_RISK_BY_REF = new Map(
  Object.entries(fallbackLimits.RISK_THRESHOLDS).map(([k, v]) => [v, k]),
);

function invalidateLimitsCache() {
  policiesCache = { data: null, expiresAt: 0 };
  configsCache = { data: null, expiresAt: 0 };
}

function getFallbackPolicy(role, transactionType) {
  const r = role === "MERCHANT" ? "MERCHANT" : "USER";
  const t = String(transactionType || "").toUpperCase();
  const amountRule =
    (r === "MERCHANT" && fallbackLimits.MERCHANT_AMOUNT[t]) ||
    fallbackLimits.AMOUNT[t] || { min: 1_000, max: 50_000_000 };
  const dailyMap = fallbackLimits.DAILY_LIMIT[r] || fallbackLimits.DAILY_LIMIT.USER;
  const dailyRaw = dailyMap[t];
  return {
    min: Number(amountRule.min),
    max: Number(amountRule.max),
    dailyLimit: dailyRaw == null ? null : Number(dailyRaw),
  };
}

function getFallbackConfig(key) {
  if (key === "EXPORT_MAX_ROWS") return fallbackLimits.EXPORT.MAX_ROWS;
  return fallbackLimits[key];
}

async function loadPolicies(db = pool) {
  const now = Date.now();
  if (policiesCache.data && now < policiesCache.expiresAt) {
    return policiesCache.data;
  }

  try {
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
    policiesCache = { data: map, expiresAt: now + CACHE_TTL_MS };
    return map;
  } catch (err) {
    console.warn("[limitsDb] Không đọc được transaction_limit_policies:", err.message);
    return policiesCache.data || new Map();
  }
}

async function loadConfigs(db = pool) {
  const now = Date.now();
  if (configsCache.data && now < configsCache.expiresAt) {
    return configsCache.data;
  }

  try {
    const res = await db.query(`SELECT key, value FROM system_configs`);
    const map = new Map();
    for (const row of res.rows) {
      map.set(row.key, row.value);
    }
    configsCache = { data: map, expiresAt: now + CACHE_TTL_MS };
    return map;
  } catch (err) {
    console.warn("[limitsDb] Không đọc được system_configs:", err.message);
    return configsCache.data || new Map();
  }
}

async function getSystemConfig(key, db = pool) {
  const configs = await loadConfigs(db);
  if (configs.has(key)) {
    return configs.get(key);
  }
  return getFallbackConfig(key);
}

async function getTransactionPolicy(role, transactionType, db = pool) {
  const r = role === "MERCHANT" ? "MERCHANT" : "USER";
  const t = String(transactionType || "").toUpperCase();
  const policies = await loadPolicies(db);
  return policies.get(`${r}:${t}`) || getFallbackPolicy(r, t);
}

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
 * Lấy hạn mức hiệu lực cho 1 giao dịch cụ thể của user/merchant:
 * luôn lấy mức nhỏ hơn giữa trần hệ thống và hạn mức riêng của người dùng.
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

async function resolveRiskThreshold(optionObj) {
  const fallbackDefault = fallbackLimits.RISK_THRESHOLDS.DEFAULT;
  const key =
    (typeof optionObj === "string" && optionObj) ||
    FALLBACK_RISK_BY_REF.get(optionObj) ||
    null;

  const liveMap = await getSystemConfig("RISK_THRESHOLDS", pool);
  if (key && liveMap && liveMap[key]) {
    return {
      challenge: Number(liveMap[key].challenge ?? fallbackDefault.challenge),
      block: Number(liveMap[key].block ?? fallbackDefault.block),
    };
  }
  if (
    optionObj &&
    typeof optionObj === "object" &&
    (optionObj.challenge !== undefined || optionObj.block !== undefined)
  ) {
    return {
      challenge: Number(optionObj.challenge ?? fallbackDefault.challenge),
      block: Number(optionObj.block ?? fallbackDefault.block),
    };
  }
  const def = (liveMap && liveMap.DEFAULT) || fallbackDefault;
  return {
    challenge: Number(def.challenge),
    block: Number(def.block),
  };
}

module.exports = {
  invalidateLimitsCache,
  getSystemConfig,
  getTransactionPolicy,
  getUserCustomLimit,
  getEffectiveTransactionLimit,
  resolveRiskThreshold,
};

