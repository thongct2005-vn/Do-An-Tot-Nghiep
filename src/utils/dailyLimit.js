const { httpError } = require("./httpError");
const { formatVnd } = require("./amount");
const {
  getSystemConfig,
  getTransactionPolicy,
  getUserCustomLimit,
  getEffectiveTransactionLimit,
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
  if (!bucket) throw httpError(500, `Loại giao dịch chưa có hạn mức: ${type}`);
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

// Lấy hạn mức đã dùng trong ngày của 1 người dùng theo loại giao dịch
async function getDailyUsed(db, userId, type) {
  const timezone = (await getSystemConfig("DAILY_LIMIT_TIMEZONE", db)) || "Asia/Ho_Chi_Minh";
  const types = BUCKET_TYPES[toBucket(type)].map((t) => `'${t}'`).join(", ");
  const result = await db.query(
    `SELECT COALESCE(SUM(amount + fee), 0)::BIGINT AS daily_used
       FROM transactions
      WHERE source_user_id = $1
        AND transaction_type IN (${types})
        AND (transaction_type <> 'PAYMENT' OR destination_user_id IS NOT NULL)
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

// Lấy danh sách hạn mức tối đa, đã dùng, còn lại của từng loại giao dịch trong ngày
async function getDailyUsage(db, userId, role) {
  const usage = {};
  for (const bucket of Object.keys(BUCKET_TYPES)) {
    const limit = await getDailyLimit(db, { userId, role, type: bucket });
    const used = await getDailyUsed(db, userId, bucket);
    usage[bucket] = {
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  }
  return usage;
}

/**
 * Lấy hạn mức hiệu lực mỗi lần (min/max) và hạn mức ngày (limit/used/remaining)
 * từ `transaction_limit_policies` kết hợp `user_transaction_limits`.
 */
async function getTransactionLimitsSummary(db, { userId = null, role = "USER" } = {}) {
  const normalizedRole = role === "MERCHANT" ? "MERCHANT" : "USER";
  const result = {};

  for (const transactionType of LIMIT_TRANSACTION_TYPES) {
    const rule = await getEffectiveTransactionLimit(db, {
      userId,
      role: normalizedRole,
      transactionType,
    });
    const dailyLimit = rule.dailyLimit == null ? null : Number(rule.dailyLimit);
    let dailyUsed = null;
    let dailyRemaining = null;

    if (userId && BUCKET_TYPES[transactionType]) {
      dailyUsed = await getDailyUsed(db, userId, transactionType);
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
  }

  return result;
}

module.exports = {
  assertDailyLimit,
  getDailyLimit,
  getDailyUsed,
  getDailyUsage,
  getTransactionLimitsSummary,
};
