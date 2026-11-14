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

const adminDashboardRepository = {
  /**
   * Tổng hợp 5 chỉ số KPI dòng tiền trong khoảng nửa mở [startInstant, nextDayInstant).
   */
  async getKpiSummary(startInstant, nextDayInstant) {
    const rollupUntil = await ensureRollupConsistent(pool);
    const { branches, params } = buildHybridBranches({
      startInstant,
      nextDayInstant,
      rollupUntil,
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
    });

    if (branches.length === 0) {
      return {
        total_transactions: 0,
        total_topup: 0,
        total_withdraw: 0,
        total_qr_payment: 0,
        total_transfer: 0,
      };
    }

    const query = `
      SELECT
        COALESCE(SUM(total_transactions), 0)::int AS total_transactions,
        COALESCE(SUM(total_topup), 0) AS total_topup,
        COALESCE(SUM(total_withdraw), 0) AS total_withdraw,
        COALESCE(SUM(total_qr_payment), 0) AS total_qr_payment,
        COALESCE(SUM(total_transfer), 0) AS total_transfer
      FROM (
        ${branches.join("\n        UNION ALL\n")}
      ) combined
    `;
    const { rows } = await pool.query(query, params);
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
  async getStatusDistributionByType(startInstant, nextDayInstant) {
    const rollupUntil = await ensureRollupConsistent(pool);
    const { branches, params } = buildHybridBranches({
      startInstant,
      nextDayInstant,
      rollupUntil,
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
    });

    if (branches.length === 0) {
      return [];
    }

    const query = `
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
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  /**
   * Tổng hợp dòng tiền (Nạp, Rút, Thanh toán QR) theo bucket thời gian.
   */
  async getCashflowRowsByBucket(startInstant, nextDayInstant, groupBy) {
    const rollupUntil = await ensureRollupConsistent(pool);
    const { unit, format } = getTruncConfig(groupBy);

    const { branches, params } = buildHybridBranches({
      startInstant,
      nextDayInstant,
      rollupUntil,
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
    });

    if (branches.length === 0) {
      return [];
    }

    const query = `
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
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  /**
   * Tổng hợp số lượng giao dịch phát sinh theo bucket thời gian (không cộng dồn).
   */
  async getTransactionVolumeRowsByBucket(startInstant, nextDayInstant, groupBy) {
    const rollupUntil = await ensureRollupConsistent(pool);
    const { unit, format } = getTruncConfig(groupBy);

    const { branches, params } = buildHybridBranches({
      startInstant,
      nextDayInstant,
      rollupUntil,
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
    });

    if (branches.length === 0) {
      return [];
    }

    const query = `
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
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },
};

module.exports = adminDashboardRepository;
