const pool = require("../../config/database");
const {
  ensureRollupConsistent,
  computeHybridWindow,
} = require("./dashboardRollup");

/**
 * Cấu hình DATE_TRUNC và định dạng TO_CHAR tương ứng theo Asia/Ho_Chi_Minh.
 * Dùng DATE_TRUNC để PostgreSQL ước lượng đúng số lượng nhóm (HashAggregate, tránh external sort).
 * @param {"hour" | "day" | "week" | "month"} groupBy
 * @returns {{ unit: string, format: string }}
 */
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
    rollupUntil
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

async function queryHybridWithFallback(startInstant, nextDayInstant, rollupUntil, buildFn, queryBuilder) {
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

const adminDashboardRepository = {
  /**
   * Tổng hợp 5 chỉ số KPI dòng tiền trong khoảng nửa mở [startInstant, nextDayInstant).
   */
  async getKpiSummary(startInstant, nextDayInstant, options = {}) {
    const rollupUntil = await resolveConsistencyCutoff(options);
    const rows = await queryHybridWithFallback(
      startInstant,
      nextDayInstant,
      rollupUntil,
      (cutoff) =>
        buildHybridBranches({
          startInstant,
          nextDayInstant,
          rollupUntil: cutoff,
          rollupBranchSql: (sIdx, eIdx) => `
        SELECT
          COALESCE(SUM(tx_count), 0) AS total_transactions,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'TOPUP' AND UPPER(status) IN ('SUCCESS', 'COMPLETED') THEN total_amount ELSE 0 END), 0) AS total_topup,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAW' AND UPPER(status) IN ('SUCCESS', 'COMPLETED') THEN total_amount ELSE 0 END), 0) AS total_withdraw,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'PAYMENT' AND UPPER(status) IN ('SUCCESS', 'COMPLETED') THEN total_amount ELSE 0 END), 0) AS total_qr_payment,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'TRANSFER' AND UPPER(status) IN ('SUCCESS', 'COMPLETED') THEN total_amount ELSE 0 END), 0) AS total_transfer
        FROM public.dashboard_tx_hourly
        WHERE bucket_hour >= ${sIdx} AND bucket_hour < ${eIdx}
      `,
          tailBranchSql: (sIdx, eIdx) => `
        SELECT
          COUNT(*) AS total_transactions,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type::text) = 'TOPUP' AND UPPER(status::text) IN ('SUCCESS', 'COMPLETED') THEN amount ELSE 0 END), 0) AS total_topup,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type::text) = 'WITHDRAW' AND UPPER(status::text) IN ('SUCCESS', 'COMPLETED') THEN amount ELSE 0 END), 0) AS total_withdraw,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type::text) = 'PAYMENT' AND UPPER(status::text) IN ('SUCCESS', 'COMPLETED') THEN amount ELSE 0 END), 0) AS total_qr_payment,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type::text) = 'TRANSFER' AND UPPER(status::text) IN ('SUCCESS', 'COMPLETED') THEN amount ELSE 0 END), 0) AS total_transfer
        FROM public.transactions
        WHERE created_at >= ${sIdx} AND created_at < ${eIdx}
      `,
        }),
      (branches) => `
      SELECT
        COALESCE(SUM(total_transactions), 0)::int AS total_transactions,
        COALESCE(SUM(total_topup), 0) AS total_topup,
        COALESCE(SUM(total_withdraw), 0) AS total_withdraw,
        COALESCE(SUM(total_qr_payment), 0) AS total_qr_payment,
        COALESCE(SUM(total_transfer), 0) AS total_transfer
      FROM (
        ${branches.join("\n        UNION ALL\n")}
      ) combined
    `,
    );

    if (!rows) {
      return {
        total_transactions: 0,
        total_topup: 0,
        total_withdraw: 0,
        total_qr_payment: 0,
        total_transfer: 0,
      };
    }

    return (
      rows[0] || {
        total_transactions: 0,
        total_topup: 0,
        total_withdraw: 0,
        total_qr_payment: 0,
        total_transfer: 0,
      }
    );
  },

  /**
   * Tổng hợp tỷ lệ trạng thái giao dịch theo từng loại (TOPUP, WITHDRAW, TRANSFER, PAYMENT).
   */
  async getStatusDistributionByType(startInstant, nextDayInstant, options = {}) {
    const rollupUntil = await resolveConsistencyCutoff(options);
    const rows = await queryHybridWithFallback(
      startInstant,
      nextDayInstant,
      rollupUntil,
      (cutoff) =>
        buildHybridBranches({
          startInstant,
          nextDayInstant,
          rollupUntil: cutoff,
          rollupBranchSql: (sIdx, eIdx) => `
        SELECT
          UPPER(transaction_type) AS transaction_type,
          COALESCE(SUM(tx_count), 0) AS total_count,
          COALESCE(SUM(CASE WHEN UPPER(status) IN ('SUCCESS', 'COMPLETED') THEN tx_count ELSE 0 END), 0) AS completed_count,
          COALESCE(SUM(CASE WHEN UPPER(status) = 'PENDING' THEN tx_count ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN UPPER(status) IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN tx_count ELSE 0 END), 0) AS failed_count
        FROM public.dashboard_tx_hourly
        WHERE bucket_hour >= ${sIdx} AND bucket_hour < ${eIdx}
        GROUP BY UPPER(transaction_type)
      `,
          tailBranchSql: (sIdx, eIdx) => `
        SELECT
          UPPER(transaction_type::text) AS transaction_type,
          COUNT(*) AS total_count,
          COUNT(*) FILTER (WHERE UPPER(status::text) IN ('SUCCESS', 'COMPLETED')) AS completed_count,
          COUNT(*) FILTER (WHERE UPPER(status::text) = 'PENDING') AS pending_count,
          COUNT(*) FILTER (WHERE UPPER(status::text) IN ('FAILED', 'CANCELLED', 'EXPIRED')) AS failed_count
        FROM public.transactions
        WHERE created_at >= ${sIdx} AND created_at < ${eIdx}
        GROUP BY UPPER(transaction_type::text)
      `,
        }),
      (branches) => `
      SELECT
        transaction_type,
        COALESCE(SUM(total_count), 0)::int AS total_count,
        COALESCE(SUM(completed_count), 0)::int AS completed_count,
        COALESCE(SUM(pending_count), 0)::int AS pending_count,
        COALESCE(SUM(failed_count), 0)::int AS failed_count
      FROM (
        ${branches.join("\n        UNION ALL\n")}
      ) combined
      GROUP BY transaction_type
    `,
    );

    return rows || [];
  },

  /**
   * Tổng hợp dòng tiền (Nạp, Rút, Thanh toán QR) theo bucket thời gian.
   */
  async getCashflowRowsByBucket(startInstant, nextDayInstant, groupBy, options = {}) {
    const rollupUntil = await resolveConsistencyCutoff(options);
    const { unit, format } = getTruncConfig(groupBy);

    const rows = await queryHybridWithFallback(
      startInstant,
      nextDayInstant,
      rollupUntil,
      (cutoff) =>
        buildHybridBranches({
          startInstant,
          nextDayInstant,
          rollupUntil: cutoff,
          rollupBranchSql: (sIdx, eIdx) => `
        SELECT
          DATE_TRUNC('${unit}', bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'TOPUP' AND UPPER(status) IN ('SUCCESS', 'COMPLETED') THEN total_amount ELSE 0 END), 0) AS topup,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAW' AND UPPER(status) IN ('SUCCESS', 'COMPLETED') THEN total_amount ELSE 0 END), 0) AS withdraw,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'PAYMENT' AND UPPER(status) IN ('SUCCESS', 'COMPLETED') THEN total_amount ELSE 0 END), 0) AS qr_payment
        FROM public.dashboard_tx_hourly
        WHERE bucket_hour >= ${sIdx} AND bucket_hour < ${eIdx}
        GROUP BY 1
      `,
          tailBranchSql: (sIdx, eIdx) => `
        SELECT
          DATE_TRUNC('${unit}', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type::text) = 'TOPUP' AND UPPER(status::text) IN ('SUCCESS', 'COMPLETED') THEN amount ELSE 0 END), 0) AS topup,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type::text) = 'WITHDRAW' AND UPPER(status::text) IN ('SUCCESS', 'COMPLETED') THEN amount ELSE 0 END), 0) AS withdraw,
          COALESCE(SUM(CASE WHEN UPPER(transaction_type::text) = 'PAYMENT' AND UPPER(status::text) IN ('SUCCESS', 'COMPLETED') THEN amount ELSE 0 END), 0) AS qr_payment
        FROM public.transactions
        WHERE created_at >= ${sIdx} AND created_at < ${eIdx}
        GROUP BY 1
      `,
        }),
      (branches) => `
      SELECT
        TO_CHAR(bucket_ts, '${format}') AS bucket_key,
        COALESCE(SUM(topup), 0) AS topup,
        COALESCE(SUM(withdraw), 0) AS withdraw,
        COALESCE(SUM(qr_payment), 0) AS qr_payment
      FROM (
        ${branches.join("\n        UNION ALL\n")}
      ) combined
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC
    `,
    );

    return rows || [];
  },

  /**
   * Tổng hợp số lượng giao dịch phát sinh theo bucket thời gian (không cộng dồn).
   */
  async getTransactionVolumeRowsByBucket(startInstant, nextDayInstant, groupBy, options = {}) {
    const rollupUntil = await resolveConsistencyCutoff(options);
    const { unit, format } = getTruncConfig(groupBy);

    const rows = await queryHybridWithFallback(
      startInstant,
      nextDayInstant,
      rollupUntil,
      (cutoff) =>
        buildHybridBranches({
          startInstant,
          nextDayInstant,
          rollupUntil: cutoff,
          rollupBranchSql: (sIdx, eIdx) => `
        SELECT
          DATE_TRUNC('${unit}', bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
          COALESCE(SUM(tx_count), 0) AS count,
          COALESCE(SUM(CASE WHEN UPPER(status) IN ('SUCCESS', 'COMPLETED') THEN tx_count ELSE 0 END), 0) AS completed_count,
          COALESCE(SUM(CASE WHEN UPPER(status) = 'PENDING' THEN tx_count ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN UPPER(status) IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN tx_count ELSE 0 END), 0) AS failed_count
        FROM public.dashboard_tx_hourly
        WHERE bucket_hour >= ${sIdx} AND bucket_hour < ${eIdx}
        GROUP BY 1
      `,
          tailBranchSql: (sIdx, eIdx) => `
        SELECT
          DATE_TRUNC('${unit}', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
          COUNT(*) AS count,
          COUNT(*) FILTER (WHERE UPPER(status::text) IN ('SUCCESS', 'COMPLETED')) AS completed_count,
          COUNT(*) FILTER (WHERE UPPER(status::text) = 'PENDING') AS pending_count,
          COUNT(*) FILTER (WHERE UPPER(status::text) IN ('FAILED', 'CANCELLED', 'EXPIRED')) AS failed_count
        FROM public.transactions
        WHERE created_at >= ${sIdx} AND created_at < ${eIdx}
        GROUP BY 1
      `,
        }),
      (branches) => `
      SELECT
        TO_CHAR(bucket_ts, '${format}') AS bucket_key,
        COALESCE(SUM(count), 0)::int AS count,
        COALESCE(SUM(completed_count), 0)::int AS completed_count,
        COALESCE(SUM(pending_count), 0)::int AS pending_count,
        COALESCE(SUM(failed_count), 0)::int AS failed_count
      FROM (
        ${branches.join("\n        UNION ALL\n")}
      ) combined
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC
    `,
    );

    return rows || [];
  },

  /**
   * Tổng hợp doanh thu thực thu Ví trả sau (phí dịch vụ + phí trễ hạn) từ fee_ledger_entries
   * trong khoảng nửa mở [startInstant, nextDayInstant).
   */
  async getPostpaidRevenueSummary(startInstant, nextDayInstant) {
    try {
      const { rows } = await pool.query(
        `
        SELECT
          COALESCE(SUM(l.amount), 0)::bigint AS total_revenue,
          COALESCE(SUM(l.amount) FILTER (WHERE l.fee_type = 'POSTPAID_SERVICE_FEE'), 0)::bigint AS service_fee_revenue,
          COALESCE(SUM(l.amount) FILTER (WHERE l.fee_type = 'POSTPAID_LATE_FEE'), 0)::bigint AS late_fee_revenue,
          COUNT(DISTINCT l.transaction_id)::int AS fee_tx_count
        FROM public.fee_ledger_entries l
        JOIN public.transactions t ON t.id = l.transaction_id
        WHERE l.fee_type IN ('POSTPAID_SERVICE_FEE', 'POSTPAID_LATE_FEE')
          AND UPPER(t.status::text) IN ('SUCCESS', 'COMPLETED')
          AND l.created_at >= $1
          AND l.created_at < $2
        `,
        [startInstant, nextDayInstant],
      );

      const row = rows[0];
      return {
        total_revenue: Number(row?.total_revenue || 0),
        service_fee_revenue: Number(row?.service_fee_revenue || 0),
        late_fee_revenue: Number(row?.late_fee_revenue || 0),
        fee_tx_count: Number(row?.fee_tx_count || 0),
      };
    } catch (err) {
      if (err && err.code === "42P01") {
        return {
          total_revenue: 0,
          service_fee_revenue: 0,
          late_fee_revenue: 0,
          fee_tx_count: 0,
        };
      }
      throw err;
    }
  },
};

module.exports = adminDashboardRepository;
