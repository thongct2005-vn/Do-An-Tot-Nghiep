const { httpError } = require("./httpError");
const { DAILY_LIMIT, DAILY_LIMIT_TIMEZONE } = require("../config/limits");
const { formatVnd } = require("./amount");
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

// Lấy hạn mức giao dịch trong ngày theo vai trò và loại giao dịch
function getDailyLimit(role, type) {
  const limit = (DAILY_LIMIT[role] || DAILY_LIMIT.USER)[toBucket(type)];
  return limit == null ? null : Number(limit);
}

async function getDailyUsed(db, userId, type) {
  const types = BUCKET_TYPES[toBucket(type)].map((t) => `'${t}'`).join(", ");
  const result = await db.query(
    `SELECT COALESCE(SUM(amount + fee), 0)::BIGINT AS daily_used
       FROM transactions
      WHERE source_user_id = $1
        AND transaction_type IN (${types})
        AND status = 'SUCCESS'
        AND created_at >= (NOW() AT TIME ZONE $2::text)::date AT TIME ZONE $2::text`,
    [userId, DAILY_LIMIT_TIMEZONE],
  );
  return Number(result.rows[0]?.daily_used || 0);
}

async function resolveRole(db, userId) {
  const result = await db.query(`SELECT role FROM users WHERE id = $1`, [
    userId,
  ]);
  return result.rows[0]?.role;
}

async function assertDailyLimit(db, { userId, role, type, amount, fee = 0 }) {
  const userRole = role || (await resolveRole(db, userId));
  const limit = getDailyLimit(userRole, type);
  if (limit === null) return { limit: null, used: 0, remaining: null };

  const used = await getDailyUsed(db, userId, type);
  const remaining = Math.max(0, limit - used);

  if (used + Number(amount) + Number(fee) > limit) {
    throw httpError(
      422,
      `Vượt quá hạn mức ${BUCKET_LABEL[toBucket(type)]} trong ngày (${formatVnd(limit)}). ` +
        `Hôm nay bạn đã dùng ${formatVnd(used)}, còn lại ${formatMoney(remaining)}`,
    );
  }
  return { limit, used, remaining };
}

async function getDailyUsage(db, userId, role) {
  const usage = {};
  for (const bucket of Object.keys(BUCKET_TYPES)) {
    const limit = getDailyLimit(role, bucket);
    const used = await getDailyUsed(db, userId, bucket);
    usage[bucket] = {
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  }
  return usage;
}

module.exports = {
  assertDailyLimit,
  getDailyLimit,
  getDailyUsed,
  getDailyUsage,
};
