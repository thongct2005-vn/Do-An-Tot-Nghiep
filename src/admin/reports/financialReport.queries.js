// financialReport.queries.js: Các câu truy vấn thô/hybrid rollup,
// chuẩn hóa số học và đọc trạng thái snapshot báo cáo tài chính.
const {
  computeHybridWindow,
  isMissingRelationError,
  getReportRollupState,
} = require("./reportRollup");
const { getRollupState: getDashboardRollupState } = require("../dashboard/dashboardRollup");
const { exactInteger } = require("./financialReport.data");

const SUCCESS = "('SUCCESS','COMPLETED')";
const FEE_SOURCE = `
  SELECT l.amount, l.created_at, l.fee_type,
    CASE WHEN l.fee_type='QR_FEE' THEN 'QR_FEE_' || COALESCE(t.transaction_type::text,'UNKNOWN')
      ELSE l.fee_type END AS category,
    CASE WHEN l.fee_type='QR_FEE' THEN
      COALESCE(t.status IN ${SUCCESS} AND u.role='MERCHANT'
        AND t.transaction_type::text IN ('PAYMENT','TRANSFER')
        AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL',false)
      WHEN l.transaction_id IS NULL THEN l.fee_type='MONTHLY_PLAN_FEE'
      ELSE COALESCE(t.status IN ${SUCCESS},false) END AS eligible
  FROM fee_ledger_entries l
  LEFT JOIN transactions t ON t.id=l.transaction_id
  LEFT JOIN users u ON u.id=t.destination_user_id
  WHERE l.created_at >= $1 AND l.created_at < $2`;

function numericRows(rows, keys) {
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(keys.map((key) => [key, exactInteger(row[key])])),
  }));
}

async function queryCashflowRaw(db, filters) {
  const { rows } = await db.query(
    `SELECT
    CASE
      WHEN transaction_type='REFUND'
        OR (transaction_type='TRANSFER' AND COALESCE(fee_rate_snapshot->>'operation_type','')='REVERSAL')
      THEN 'PAYMENT_REVERSAL'
      ELSE transaction_type::text
    END AS type,
    count(*) AS total,
    count(*) FILTER (WHERE status IN ${SUCCESS}) AS success,
    count(*) FILTER (WHERE status='PENDING') AS pending,
    count(*) FILTER (WHERE status='FAILED') AS failed,
    count(*) FILTER (WHERE status NOT IN ('SUCCESS','COMPLETED','PENDING','FAILED')) AS other,
    coalesce(sum(amount) FILTER (WHERE status IN ${SUCCESS}),0) AS gross
    FROM transactions WHERE created_at >= $1 AND created_at < $2
    GROUP BY 1 ORDER BY 1`,
    [filters.startInstant, filters.nextDayInstant],
  );
  const data = numericRows(rows, [
    "total",
    "success",
    "pending",
    "failed",
    "other",
    "gross",
  ]);
  for (const type of ["TOPUP", "WITHDRAW", "TRANSFER", "PAYMENT"]) {
    if (!data.some((row) => row.type === type)) {
      data.push({
        type,
        total: 0,
        success: 0,
        pending: 0,
        failed: 0,
        other: 0,
        gross: 0,
      });
    }
  }
  return data;
}

async function verifyQrFeeRollupWindow(db, startInstant, splitInstant) {
  try {
    const { rows } = await db.query(
      `SELECT
        (SELECT count(*)::text FROM public.fee_ledger_entries WHERE fee_type = 'QR_FEE' AND created_at >= $1 AND created_at < $2) AS ledger_cnt,
        (SELECT coalesce(sum(amount), 0)::text FROM public.fee_ledger_entries WHERE fee_type = 'QR_FEE' AND created_at >= $1 AND created_at < $2) AS ledger_sum,
        (SELECT coalesce(sum(fee_tx_count), 0)::text FROM public.report_merchant_fee_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2) AS rollup_cnt,
        (SELECT coalesce(sum(fee_amount), 0)::text FROM public.report_merchant_fee_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2) AS rollup_sum`,
      [startInstant, splitInstant],
    );
    const r = rows[0];
    if (!r) return false;
    return (
      BigInt(r.ledger_cnt) === BigInt(r.rollup_cnt) &&
      BigInt(r.ledger_sum) === BigInt(r.rollup_sum)
    );
  } catch (err) {
    if (isMissingRelationError(err)) return false;
    throw err;
  }
}

async function queryFeesRaw(db, filters) {
  const { rows } = await db.query(
    `WITH source AS (${FEE_SOURCE})
    SELECT category, eligible, count(*) AS entries, coalesce(sum(amount),0) AS revenue
    FROM source GROUP BY category,eligible ORDER BY category,eligible`,
    [filters.startInstant, filters.nextDayInstant],
  );
  return numericRows(rows, ["entries", "revenue"]);
}

async function querySystemSeriesRaw(db, filters) {
  const { rows } = await db.query(
    `WITH fee_source AS (${FEE_SOURCE}),
    fee_buckets AS (
      SELECT date_trunc($3, created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') bucket,
        sum(amount) AS revenue,
        coalesce(sum(amount) FILTER (WHERE fee_type='QR_FEE'),0) AS qr_fee
      FROM fee_source WHERE eligible GROUP BY 1
    ), tx_buckets AS (
      SELECT date_trunc($3, created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') bucket,
        count(*) AS transactions,
        coalesce(sum(amount) FILTER (WHERE transaction_type='TOPUP'),0) AS topup,
        coalesce(sum(amount) FILTER (WHERE transaction_type='WITHDRAW'),0) AS withdraw,
        coalesce(sum(amount) FILTER (WHERE transaction_type='PAYMENT'),0) AS payment,
        coalesce(sum(amount) FILTER (WHERE transaction_type='TRANSFER' AND COALESCE(fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'),0) AS transfer,
        coalesce(sum(amount) FILTER (WHERE transaction_type='REFUND' OR (transaction_type='TRANSFER' AND fee_rate_snapshot->>'operation_type'='REVERSAL')),0) AS payment_reversal
      FROM transactions WHERE created_at >= $1 AND created_at < $2 AND status IN ${SUCCESS} GROUP BY 1
    ), buckets AS (
      SELECT generate_series(date_trunc($3,$1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'),
        date_trunc($3,($2::timestamptz-interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
        CASE $3 WHEN 'year' THEN interval '1 year' WHEN 'quarter' THEN interval '3 months'
          WHEN 'month' THEN interval '1 month' WHEN 'week' THEN interval '1 week' ELSE interval '1 day' END) bucket
    ) SELECT to_char(b.bucket,'YYYY-MM-DD') AS bucket,
      coalesce(t.topup,0) AS topup, coalesce(t.withdraw,0) AS withdraw,
      coalesce(t.payment,0) AS payment, coalesce(t.transfer,0) AS transfer,
      coalesce(t.payment_reversal,0) AS payment_reversal,
      coalesce(t.transactions,0) AS transactions, coalesce(f.revenue,0) AS revenue,
      coalesce(f.qr_fee,0) AS qr_fee
    FROM buckets b LEFT JOIN tx_buckets t USING(bucket) LEFT JOIN fee_buckets f USING(bucket)
    ORDER BY b.bucket`,
    [filters.startInstant, filters.nextDayInstant, filters.group],
  );
  return numericRows(rows, [
    "topup",
    "withdraw",
    "payment",
    "transfer",
    "payment_reversal",
    "transactions",
    "revenue",
    "qr_fee",
  ]);
}

async function queryControlsRaw(db, filters) {
  const { rows } = await db.query(
    `WITH fee_source AS (${FEE_SOURCE})
    SELECT (SELECT coalesce(sum(amount),0)::text FROM fee_source WHERE eligible) AS revenue,
      (SELECT coalesce(sum(amount),0)::text FROM fee_source WHERE eligible AND fee_type='QR_FEE') AS qr_fee,
      (SELECT count(*)::text FROM transactions WHERE created_at >= $1 AND created_at < $2) AS transactions`,
    [filters.startInstant, filters.nextDayInstant],
  );
  return numericRows(rows, ["revenue", "transactions", "qr_fee"])[0];
}

async function queryMerchantFeeSeriesRaw(db, filters) {
  const { rows } = await db.query(
    `SELECT to_char(date_trunc($3,l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'),'YYYY-MM-DD') bucket,
    coalesce(sum(l.amount) FILTER (WHERE t.transaction_type='PAYMENT'),0) payment_fee,
    coalesce(sum(l.amount) FILTER (WHERE t.transaction_type='TRANSFER'),0) transfer_fee
    FROM fee_ledger_entries l JOIN transactions t ON t.id=l.transaction_id JOIN users u ON u.id=t.destination_user_id
    WHERE l.created_at >= $1 AND l.created_at < $2 AND l.fee_type='QR_FEE' AND t.status IN ${SUCCESS}
      AND u.role='MERCHANT' AND t.transaction_type IN ('PAYMENT','TRANSFER')
      AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'
      AND ($4::uuid IS NULL OR t.destination_user_id=$4) AND ($5::text IS NULL OR t.transaction_type::text=$5)
    GROUP BY 1 ORDER BY 1`,
    [
      filters.startInstant,
      filters.nextDayInstant,
      filters.group,
      filters.merchant,
      filters.type,
    ],
  );
  return numericRows(rows, ["payment_fee", "transfer_fee"]);
}

async function queryCombinedVerifiedFees(db, filters, hybrid) {
  const { rows } = await db.query(
    `WITH residual_ledger AS MATERIALIZED (
      SELECT l.amount, l.created_at, l.fee_type, l.transaction_id
      FROM public.fee_ledger_entries l
      WHERE l.fee_type <> 'QR_FEE' AND l.created_at >= $1 AND l.created_at < $2
      UNION ALL
      SELECT l.amount, l.created_at, l.fee_type, l.transaction_id
      FROM public.fee_ledger_entries l
      WHERE $5::boolean AND l.fee_type = 'QR_FEE' AND l.created_at >= $4 AND l.created_at < $2
    ),
    residual_source AS (
      SELECT l.amount, l.created_at, l.fee_type,
        CASE WHEN l.fee_type='QR_FEE' THEN 'QR_FEE_' || COALESCE(t.transaction_type::text,'UNKNOWN')
          ELSE l.fee_type END AS category,
        CASE WHEN l.fee_type='QR_FEE' THEN
          COALESCE(t.status IN ${SUCCESS} AND u.role='MERCHANT'
            AND t.transaction_type::text IN ('PAYMENT','TRANSFER')
            AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL',false)
          WHEN l.transaction_id IS NULL THEN l.fee_type='MONTHLY_PLAN_FEE'
          ELSE COALESCE(t.status IN ${SUCCESS},false) END AS eligible
      FROM residual_ledger l
      LEFT JOIN public.transactions t ON t.id = l.transaction_id
      LEFT JOIN public.users u ON u.id = t.destination_user_id
    ),
    combined AS (
      SELECT
        date_trunc($3, r.bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
        ('QR_FEE_' || r.transaction_type)::text AS category,
        'QR_FEE'::text AS fee_type,
        true AS eligible,
        SUM(r.fee_tx_count)::bigint AS entries,
        SUM(r.fee_amount)::numeric AS revenue
      FROM public.report_merchant_fee_hourly r
      WHERE r.bucket_hour >= $1 AND r.bucket_hour < $4 AND r.fee_tx_count > 0
      GROUP BY 1, 2
      UNION ALL
      SELECT
        date_trunc($3, created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
        category,
        fee_type::text AS fee_type,
        eligible,
        COUNT(*)::bigint AS entries,
        COALESCE(SUM(amount), 0)::numeric AS revenue
      FROM residual_source
      GROUP BY 1, 2, 3, 4
    ),
    fees_agg AS (
      SELECT category, eligible, COALESCE(SUM(entries), 0) AS entries, COALESCE(SUM(revenue), 0) AS revenue
      FROM combined
      GROUP BY category, eligible
      ORDER BY category, eligible
    ),
    fee_buckets AS (
      SELECT to_char(bucket, 'YYYY-MM-DD') AS bucket,
        COALESCE(SUM(revenue), 0) AS revenue,
        COALESCE(SUM(revenue) FILTER (WHERE fee_type = 'QR_FEE'), 0) AS qr_fee,
        COALESCE(SUM(revenue) FILTER (WHERE category = 'QR_FEE_PAYMENT'), 0) AS payment_fee,
        COALESCE(SUM(revenue) FILTER (WHERE category = 'QR_FEE_TRANSFER'), 0) AS transfer_fee,
        COALESCE(SUM(entries) FILTER (WHERE fee_type = 'QR_FEE'), 0) AS qr_entries
      FROM combined
      WHERE eligible
      GROUP BY 1
      ORDER BY 1
    ),
    fee_controls AS (
      SELECT
        COALESCE(SUM(revenue) FILTER (WHERE eligible), 0)::text AS revenue,
        COALESCE(SUM(revenue) FILTER (WHERE eligible AND fee_type = 'QR_FEE'), 0)::text AS qr_fee
      FROM combined
    )
    SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.category, f.eligible) FROM fees_agg f), '[]'::jsonb) AS fees,
      COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.bucket) FROM fee_buckets b), '[]'::jsonb) AS fee_buckets,
      (SELECT to_jsonb(c) FROM fee_controls c) AS fee_controls`,
    [
      filters.startInstant,
      filters.nextDayInstant,
      filters.group,
      hybrid.splitInstant,
      hybrid.useTail,
    ],
  );
  const r = rows[0];
  const feesData = numericRows(r.fees || [], ["entries", "revenue"]);
  const feeBuckets = r.fee_buckets || [];
  const feeMap = new Map(
    feeBuckets.map((b) => [
      b.bucket,
      {
        revenue: exactInteger(b.revenue),
        qr_fee: exactInteger(b.qr_fee),
      },
    ]),
  );
  const merchantFeeSeriesUnfiltered = feeBuckets
    .filter((b) => Number(b.qr_entries || 0) > 0)
    .map((b) => ({
      bucket: b.bucket,
      payment_fee: exactInteger(b.payment_fee),
      transfer_fee: exactInteger(b.transfer_fee),
    }));
  const feeControls = {
    revenue: exactInteger(r.fee_controls?.revenue || 0),
    qr_fee: exactInteger(r.fee_controls?.qr_fee || 0),
  };
  return { feesData, feeMap, merchantFeeSeriesUnfiltered, feeControls };
}

async function queryCombinedTransactions(
  db,
  filters,
  feeMap,
  dashRollupUntil = null,
) {
  const dashHybrid = computeHybridWindow(
    filters.startInstant,
    filters.nextDayInstant,
    dashRollupUntil,
  );
  let aggRows;
  if (dashHybrid.useRollup) {
    try {
      const res = await db.query(
        `WITH tx_events AS (
          SELECT
            date_trunc($3, d.bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
            CASE
              WHEN d.transaction_type = 'REFUND' THEN 'PAYMENT_REVERSAL'
              ELSE d.transaction_type::text
            END AS type,
            d.status::text AS status,
            d.tx_count::bigint AS tx_count,
            d.total_amount::numeric AS total_amount
          FROM public.dashboard_tx_hourly d
          WHERE d.bucket_hour >= $1 AND d.bucket_hour < $4
          UNION ALL
          SELECT
            r.bucket_ts,
            adj.adj_type AS type,
            r.status,
            (r.tx_count * adj.sign)::bigint AS tx_count,
            (r.total_amount * adj.sign)::numeric AS total_amount
          FROM (
            SELECT
              date_trunc($3, t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
              t.status::text AS status,
              count(*)::bigint AS tx_count,
              coalesce(sum(t.amount), 0)::numeric AS total_amount
            FROM public.transactions t
            WHERE t.transaction_type = 'TRANSFER'
              AND t.created_at >= $1 AND t.created_at < $4
              AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') = 'REVERSAL'
            GROUP BY 1, 2
          ) r
          CROSS JOIN (VALUES ('TRANSFER'::text, -1), ('PAYMENT_REVERSAL'::text, 1)) AS adj(adj_type, sign)
          UNION ALL
          SELECT
            date_trunc($3, t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
            CASE
              WHEN t.transaction_type='REFUND'
                OR (t.transaction_type='TRANSFER' AND COALESCE(t.fee_rate_snapshot->>'operation_type','')='REVERSAL')
              THEN 'PAYMENT_REVERSAL'
              ELSE t.transaction_type::text
            END AS type,
            t.status::text AS status,
            count(*)::bigint AS tx_count,
            coalesce(sum(t.amount), 0)::numeric AS total_amount
          FROM public.transactions t
          WHERE $5::boolean AND t.created_at >= $4 AND t.created_at < $2
          GROUP BY 1, 2, 3
        )
        SELECT
          to_char(bucket_ts, 'YYYY-MM-DD') AS bucket,
          type,
          coalesce(sum(tx_count), 0) AS total,
          coalesce(sum(tx_count) FILTER (WHERE status IN ${SUCCESS}), 0) AS success,
          coalesce(sum(tx_count) FILTER (WHERE status='PENDING'), 0) AS pending,
          coalesce(sum(tx_count) FILTER (WHERE status='FAILED'), 0) AS failed,
          coalesce(sum(tx_count) FILTER (WHERE status NOT IN ('SUCCESS','COMPLETED','PENDING','FAILED')), 0) AS other,
          coalesce(sum(total_amount) FILTER (WHERE status IN ${SUCCESS}), 0) AS gross
        FROM tx_events
        GROUP BY bucket_ts, type
        HAVING coalesce(sum(tx_count), 0) > 0`,
        [
          filters.startInstant,
          filters.nextDayInstant,
          filters.group,
          dashHybrid.splitInstant,
          dashHybrid.useTail,
        ],
      );
      aggRows = res.rows;
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }
  }
  if (!aggRows) {
    const res = await db.query(
      `SELECT
        to_char(bucket_ts, 'YYYY-MM-DD') AS bucket,
        type, total, success, pending, failed, other, gross
      FROM (
        SELECT
          date_trunc($3, created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
          CASE
            WHEN transaction_type='REFUND'
              OR (transaction_type='TRANSFER' AND COALESCE(fee_rate_snapshot->>'operation_type','')='REVERSAL')
            THEN 'PAYMENT_REVERSAL'
            ELSE transaction_type::text
          END AS type,
          count(*) AS total,
          count(*) FILTER (WHERE status IN ${SUCCESS}) AS success,
          count(*) FILTER (WHERE status='PENDING') AS pending,
          count(*) FILTER (WHERE status='FAILED') AS failed,
          count(*) FILTER (WHERE status NOT IN ('SUCCESS','COMPLETED','PENDING','FAILED')) AS other,
          coalesce(sum(amount) FILTER (WHERE status IN ${SUCCESS}),0) AS gross
        FROM public.transactions
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1, 2
      ) g`,
      [filters.startInstant, filters.nextDayInstant, filters.group],
    );
    aggRows = res.rows;
  }
  const { rows: bucketRows } = await db.query(
    `SELECT to_char(bucket, 'YYYY-MM-DD') AS bucket
     FROM generate_series(
       date_trunc($3, $1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'),
       date_trunc($3, ($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
       CASE $3 WHEN 'year' THEN interval '1 year' WHEN 'quarter' THEN interval '3 months'
         WHEN 'month' THEN interval '1 month' WHEN 'week' THEN interval '1 week' ELSE interval '1 day' END
     ) AS bucket
     ORDER BY 1`,
    [filters.startInstant, filters.nextDayInstant, filters.group],
  );

  const byType = new Map();
  const byBucket = new Map();
  let totalTxBig = 0n;

  for (const r of aggRows) {
    const total = BigInt(r.total || 0);
    const success = BigInt(r.success || 0);
    const pending = BigInt(r.pending || 0);
    const failed = BigInt(r.failed || 0);
    const other = BigInt(r.other || 0);
    const gross = BigInt(r.gross || 0);
    totalTxBig += total;

    const prevType = byType.get(r.type) || {
      total: 0n,
      success: 0n,
      pending: 0n,
      failed: 0n,
      other: 0n,
      gross: 0n,
    };
    prevType.total += total;
    prevType.success += success;
    prevType.pending += pending;
    prevType.failed += failed;
    prevType.other += other;
    prevType.gross += gross;
    byType.set(r.type, prevType);

    const prevB = byBucket.get(r.bucket) || {
      topup: 0n,
      withdraw: 0n,
      payment: 0n,
      transfer: 0n,
      payment_reversal: 0n,
      transactions: 0n,
    };
    prevB.transactions += success;
    if (r.type === "TOPUP") prevB.topup += gross;
    else if (r.type === "WITHDRAW") prevB.withdraw += gross;
    else if (r.type === "PAYMENT") prevB.payment += gross;
    else if (r.type === "TRANSFER") prevB.transfer += gross;
    else if (r.type === "PAYMENT_REVERSAL") prevB.payment_reversal += gross;
    byBucket.set(r.bucket, prevB);
  }

  const cashflowData = [...byType.keys()]
    .sort()
    .map((type) => {
      const t = byType.get(type);
      return {
        type,
        total: exactInteger(t.total.toString()),
        success: exactInteger(t.success.toString()),
        pending: exactInteger(t.pending.toString()),
        failed: exactInteger(t.failed.toString()),
        other: exactInteger(t.other.toString()),
        gross: exactInteger(t.gross.toString()),
      };
    });
  for (const type of ["TOPUP", "WITHDRAW", "TRANSFER", "PAYMENT"]) {
    if (!cashflowData.some((row) => row.type === type)) {
      cashflowData.push({
        type,
        total: 0,
        success: 0,
        pending: 0,
        failed: 0,
        other: 0,
        gross: 0,
      });
    }
  }

  const systemSeriesData = bucketRows.map((b) => {
    const tb = byBucket.get(b.bucket);
    const fb = feeMap.get(b.bucket);
    return {
      bucket: b.bucket,
      topup: tb ? exactInteger(tb.topup.toString()) : 0,
      withdraw: tb ? exactInteger(tb.withdraw.toString()) : 0,
      payment: tb ? exactInteger(tb.payment.toString()) : 0,
      transfer: tb ? exactInteger(tb.transfer.toString()) : 0,
      payment_reversal: tb ? exactInteger(tb.payment_reversal.toString()) : 0,
      transactions: tb ? exactInteger(tb.transactions.toString()) : 0,
      revenue: fb ? fb.revenue : 0,
      qr_fee: fb ? fb.qr_fee : 0,
    };
  });

  return {
    cashflowData,
    systemSeriesData,
    totalTransactions: exactInteger(totalTxBig.toString()),
  };
}

async function readSnapshotRollupState(client) {
  const { rows: reg } = await client.query(`
    SELECT
      (to_regclass('public.report_rollup_state') IS NOT NULL
        AND to_regclass('public.report_dirty_hours') IS NOT NULL
        AND to_regclass('public.report_merchant_fee_hourly') IS NOT NULL
        AND to_regclass('public.report_merchant_tx_hourly') IS NOT NULL
        AND to_regclass('public.report_gateway_hourly') IS NOT NULL) AS has_report_rollup,
      (to_regclass('public.dashboard_rollup_state') IS NOT NULL
        AND to_regclass('public.dashboard_dirty_hours') IS NOT NULL
        AND to_regclass('public.dashboard_tx_hourly') IS NOT NULL) AS has_dash_rollup
  `);
  const flags = reg[0] || {};
  let rollupUntil = null;
  let dashRollupUntil = null;
  if (flags.has_report_rollup) {
    const reportState = await getReportRollupState(client);
    if (reportState.isFinite && !reportState.hasDirty) {
      rollupUntil = reportState.rollupUntil;
    }
  }
  if (flags.has_dash_rollup) {
    const dashState = await getDashboardRollupState(client);
    if (dashState.isFinite && !dashState.hasDirty) {
      dashRollupUntil = dashState.rollupUntil;
    }
  }
  return { rollupUntil, dashRollupUntil };
}

module.exports = {
  SUCCESS,
  FEE_SOURCE,
  numericRows,
  queryCashflowRaw,
  verifyQrFeeRollupWindow,
  queryFeesRaw,
  querySystemSeriesRaw,
  queryControlsRaw,
  queryMerchantFeeSeriesRaw,
  queryCombinedVerifiedFees,
  queryCombinedTransactions,
  readSnapshotRollupState,
};
