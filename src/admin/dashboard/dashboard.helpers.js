// dashboard.helpers.js: Cấu hình nhóm thời gian, dựng nhánh truy vấn hybrid rollup/tail và gom dữ liệu bucket cho Admin Dashboard.
const pool = require("../../config/database");
const {
  ensureRollupConsistent,
  computeHybridWindow,
} = require("./dashboardRollup");

const CANONICAL_TX_TYPES = [
  { type: "TOPUP", label: "Nạp tiền" },
  { type: "WITHDRAW", label: "Rút tiền" },
  { type: "TRANSFER", label: "Chuyển tiền" },
  { type: "PAYMENT", label: "Thanh toán QR" },
  { type: "REFUND", label: "Hoàn tiền" },
];

function getTruncConfig(groupBy) {
  switch (groupBy) {
    case "hour":
      return { unit: "hour", format: "YYYY-MM-DD HH24" };
    case "week":
      return { unit: "week", format: "YYYY-MM-DD" };
    case "month":
      return { unit: "month", format: "YYYY-MM" };
    case "day":
    default:
      return { unit: "day", format: "YYYY-MM-DD" };
  }
}

function buildHybridBranches({
  startInstant,
  nextDayInstant,
  rollupUntil,
  rollupBranchSql,
  tailBranchSql,
}) {
  const { useRollup, useTail, splitInstant } = computeHybridWindow(
    startInstant,
    nextDayInstant,
    rollupUntil,
  );

  const branches = [];
  const params = [];

  if (useRollup) {
    const startIdx = `$${params.length + 1}`;
    const endIdx = `$${params.length + 2}`;
    params.push(startInstant, splitInstant);
    branches.push(rollupBranchSql(startIdx, endIdx));
  }

  if (useTail) {
    const startIdx = `$${params.length + 1}`;
    const endIdx = `$${params.length + 2}`;
    params.push(splitInstant, nextDayInstant);
    branches.push(tailBranchSql(startIdx, endIdx));
  }

  return { branches, params };
}

async function resolveConsistencyCutoff(options = {}) {
  if (options && options.rollupUntil !== undefined) {
    return options.rollupUntil;
  }
  if (options && options.ensureConsistent === false) {
    return null;
  }
  return ensureRollupConsistent(pool);
}

async function queryHybridWithFallback(
  startInstant,
  nextDayInstant,
  rollupUntil,
  buildFn,
  queryBuilder,
) {
  const exec = async (cutoff) => {
    const { branches, params } = buildFn(cutoff);
    if (branches.length === 0) return null;
    const { rows } = await pool.query(queryBuilder(branches), params);
    return rows;
  };
  try {
    return await exec(rollupUntil);
  } catch (err) {
    if (err && err.code === "42P01" && rollupUntil) {
      return await exec(null);
    }
    throw err;
  }
}

function buildBucketRowMap(rows) {
  const rowMap = new Map();
  for (const row of rows || []) {
    rowMap.set(String(row.bucket_key), row);
  }
  return rowMap;
}

module.exports = {
  CANONICAL_TX_TYPES,
  getTruncConfig,
  buildHybridBranches,
  resolveConsistencyCutoff,
  queryHybridWithFallback,
  buildBucketRowMap,
};
