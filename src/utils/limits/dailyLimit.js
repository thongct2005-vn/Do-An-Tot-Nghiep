const { httpError } = require("../httpError");
const { formatVnd } = require("../amount");
const {
  getSystemConfig,
  getTransactionPolicy,
  getUserCustomLimit,
  getEffectiveTransactionLimit,
  getEffectiveWalletCapacity,
} = require("./limitsDb");

const LIMIT_TRANSACTION_TYPES = ["TRANSFER", "TOPUP", "WITHDRAW", "QR_PAYMENT"];

const BUCKET_TYPES = {
  TRANSFER: ["TRANSFER", "PAYMENT"],
  TOPUP: ["TOPUP"],
  WITHDRAW: ["WITHDRAW"],
};

const BUCKET_LABEL = {
  TRANSFER: "chuyển tiền",
  TOPUP: "nạp tiền",
  WITHDRAW: "rút tiền",
};

// Tìm nhóm hạn mức tương ứng với một loại giao dịch
function toBucket(type) {
  const bucket = Object.keys(BUCKET_TYPES).find((b) =>
    BUCKET_TYPES[b].includes(type),
  );
  if (!bucket) throw httpError(500, "Loại giao dịch chưa được cấu hình hạn mức ngày");
  return bucket;
}

// Lấy hạn mức giao dịch tối đa trong ngày (kết hợp chính sách hệ thống và tùy chỉnh của người dùng)
async function getDailyLimit(db, { userId = null, role = "USER", type }) {
  const bucket = toBucket(type);
  const sys = await getTransactionPolicy(role, bucket, db);
  const sysDaily = sys.dailyLimit;

  if (!userId) return sysDaily;

  let custom = await getUserCustomLimit(db, userId, type);
  if ((!custom || custom.daily_limit == null) && type !== bucket) {
    custom = await getUserCustomLimit(db, userId, bucket);
  }

  if (custom?.daily_limit == null) return sysDaily;
  const customDaily = Number(custom.daily_limit);
  return sysDaily == null ? customDaily : Math.min(sysDaily, customDaily);
}

async function getRequiredDailyLimitTimezone(db) {
  const timezone = String(
    (await getSystemConfig("DAILY_LIMIT_TIMEZONE", db)) ?? "",
  ).trim();
  if (!timezone) {
    throw httpError(500, "Cấu hình múi giờ hạn mức ngày của hệ thống không hợp lệ");
  }
  return timezone;
}

// Lấy đồng thời hạn mức đã dùng của 3 nhóm (TRANSFER/PAYMENT, TOPUP, WITHDRAW) trong 1 truy vấn duy nhất
async function getDailyUsedByBuckets(db, userId) {
  const timezone = await getRequiredDailyLimitTimezone(db);
  const result = await db.query(
    `SELECT
       COALESCE(SUM(amount + user_fee) FILTER (
         WHERE transaction_type IN ('TRANSFER', 'PAYMENT')
           AND (transaction_type <> 'PAYMENT' OR destination_user_id IS NOT NULL)
           AND COALESCE(fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
       ), 0)::BIGINT AS transfer_used,
       COALESCE(SUM(amount + user_fee) FILTER (
         WHERE transaction_type = 'TOPUP'
       ), 0)::BIGINT AS topup_used,
       COALESCE(SUM(amount + user_fee) FILTER (
         WHERE transaction_type = 'WITHDRAW'
       ), 0)::BIGINT AS withdraw_used
     FROM transactions
     WHERE source_user_id = $1
       AND transaction_type IN ('TRANSFER', 'PAYMENT', 'TOPUP', 'WITHDRAW')
       AND status = 'SUCCESS'
       AND created_at >= (NOW() AT TIME ZONE $2::text)::date AT TIME ZONE $2::text`,
    [userId, timezone],
  );
  const row = result.rows[0] || {};
  return {
    TRANSFER: Number(row.transfer_used || 0),
    TOPUP: Number(row.topup_used || 0),
    WITHDRAW: Number(row.withdraw_used || 0),
  };
}

// Lấy hạn mức đã dùng trong ngày của 1 người dùng theo loại giao dịch
async function getDailyUsed(db, userId, type) {
  const timezone = await getRequiredDailyLimitTimezone(db);
  const types = BUCKET_TYPES[toBucket(type)].map((t) => `'${t}'`).join(", ");
  const result = await db.query(
    `SELECT COALESCE(SUM(amount + user_fee), 0)::BIGINT AS daily_used
       FROM transactions
      WHERE source_user_id = $1
        AND transaction_type IN (${types})
        AND (transaction_type <> 'PAYMENT' OR destination_user_id IS NOT NULL)
        AND COALESCE(fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
        AND status = 'SUCCESS'
        AND created_at >= (NOW() AT TIME ZONE $2::text)::date AT TIME ZONE $2::text`,
    [userId, timezone],
  );
  return Number(result.rows[0]?.daily_used || 0);
}

// Lấy quyền của người dùng
async function resolveRole(db, userId) {
  const result = await db.query(`SELECT role FROM users WHERE id = $1`, [
    userId,
  ]);
  return result.rows[0]?.role;
}

// Kiểm tra và xác thực xem giao dịch sắp thực hiện có vượt quá hạn mức cho phép trong ngày hay không
async function assertDailyLimit(db, { userId, role, type, amount, fee = 0 }) {
  const userRole = role || (await resolveRole(db, userId));
  const limit = await getDailyLimit(db, { userId, role: userRole, type });
  if (limit === null) return { limit: null, used: 0, remaining: null };

  const used = await getDailyUsed(db, userId, type);
  const remaining = Math.max(0, limit - used);

  if (used + Number(amount) + Number(fee) > limit) {
    throw httpError(
      422,
      `Vượt quá hạn mức ${BUCKET_LABEL[toBucket(type)]} trong ngày (${formatVnd(limit)}). ` +
        `Hôm nay bạn đã dùng ${formatVnd(used)}, còn lại ${formatVnd(remaining)}`,
    );
  }
  return { limit, used, remaining };
}

// Kiểm tra xem số dư ví sau khi nhận tiền / nạp tiền có vượt quá sức chứa tối đa của ví không
async function assertWalletCapacity(
  db,
  { userId, role, currentBalance, inboundAmount, isRecipient = false },
) {
  const userRole = role || (await resolveRole(db, userId));
  const { effectiveCapacity } = await getEffectiveWalletCapacity(db, {
    userId,
    role: userRole,
  });

  const cur = Number(currentBalance) || 0;
  const add = Number(inboundAmount) || 0;
  if (cur + add > effectiveCapacity) {
    if (isRecipient) {
      throw httpError(
        422,
        "Ví của người nhận đã đạt giới hạn sức chứa tối đa, không thể nhận thêm tiền lúc này",
      );
    }
    const remainingCap = Math.max(0, effectiveCapacity - cur);
    throw httpError(
      422,
      `Vượt quá sức chứa tối đa của ví (${formatVnd(effectiveCapacity)}). Hiện tại ví của bạn chỉ có thể nạp thêm tối đa ${formatVnd(remainingCap)}`,
    );
  }
}

// Lấy danh sách hạn mức tối đa, đã dùng, còn lại của từng loại giao dịch trong ngày trong 1 lượt đọc DB
async function getDailyUsage(db, userId, role) {
  const buckets = Object.keys(BUCKET_TYPES);
  const [usedByBucket, ...limits] = await Promise.all([
    getDailyUsedByBuckets(db, userId),
    ...buckets.map((bucket) => getDailyLimit(db, { userId, role, type: bucket })),
  ]);

  const usage = {};
  buckets.forEach((bucket, idx) => {
    const limit = limits[idx];
    const used = usedByBucket[bucket] ?? 0;
    usage[bucket] = {
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  });
  return usage;
}

/**
 * Lấy hạn mức hiệu lực mỗi lần (min/max) và hạn mức ngày (limit/used/remaining)
 * từ `system_configs["TRANSACTION_LIMIT_CONFIG"]` kết hợp `user_transaction_limits`.
 */
async function getTransactionLimitsSummary(db, { userId = null, role = "USER" } = {}) {
  const normalizedRole = role === "MERCHANT" ? "MERCHANT" : "USER";
  const [rules, usedByBucket] = await Promise.all([
    Promise.all(
      LIMIT_TRANSACTION_TYPES.map((transactionType) =>
        getEffectiveTransactionLimit(db, {
          userId,
          role: normalizedRole,
          transactionType,
        }),
      ),
    ),
    userId ? getDailyUsedByBuckets(db, userId) : Promise.resolve(null),
  ]);

  const result = {};
  LIMIT_TRANSACTION_TYPES.forEach((transactionType, idx) => {
    const rule = rules[idx];
    const dailyLimit = rule.dailyLimit == null ? null : Number(rule.dailyLimit);
    let dailyUsed = null;
    let dailyRemaining = null;

    if (userId && BUCKET_TYPES[transactionType] && usedByBucket) {
      dailyUsed = usedByBucket[transactionType] ?? 0;
      dailyRemaining =
        dailyLimit === null ? null : Math.max(0, dailyLimit - dailyUsed);
    }

    result[transactionType] = {
      min_amount: Number(rule.min),
      max_amount: Number(rule.max),
      daily_limit: dailyLimit,
      daily_used: dailyUsed,
      daily_remaining: dailyRemaining,
    };
  });

  return result;
}

module.exports = {
  assertDailyLimit,
  assertWalletCapacity,
  getDailyLimit,
  getDailyUsed,
  getDailyUsage,
  getTransactionLimitsSummary,
  resolveRole,
};
