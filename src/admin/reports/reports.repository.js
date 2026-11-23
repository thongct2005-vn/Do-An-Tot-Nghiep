// reports.repository.js: Truy vấn tăng trưởng tài khoản và ủy quyền truy vấn báo cáo phí Merchant cho Admin.
const pool = require("../../config/database");
const { ensureRollupConsistent: ensureDashboardRollupConsistent } = require("../dashboard/dashboardRollup");
const {
  ensureReportRollupConsistent,
  queryFeeRevenueSummary,
  queryMerchantsPage,
  queryReportFull,
  queryGrowthVolume,
} = require("./reportRollup");
const { with42P01Fallback } = require("./reports.helpers");

const adminReportsRepository = {
  // Separate ledger and transaction events avoid multiplying transactions by fee rows.
  // Kept exported for baseline/EXPLAIN verification compatibility; runtime path delegates to reportRollup.
  REPORT_SQL: `
WITH events AS MATERIALIZED (
  SELECT u.id merchant_id, t.transaction_type::text type,
    date_trunc($5, l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') bucket,
    l.amount revenue, 0::bigint gross, 0::bigint tx_count
  FROM fee_ledger_entries l JOIN transactions t ON t.id=l.transaction_id
  JOIN users u ON u.id=t.destination_user_id AND u.role='MERCHANT'
  WHERE l.fee_type='QR_FEE' AND t.status IN ('SUCCESS','COMPLETED')
    AND t.transaction_type IN ('PAYMENT','TRANSFER')
    AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'
    AND l.created_at >= $1 AND l.created_at < $2
    AND ($3::uuid IS NULL OR u.id=$3) AND ($4::text IS NULL OR t.transaction_type::text=$4)
  UNION ALL
  SELECT u.id, t.transaction_type::text,
    date_trunc($5, t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'),
    0::bigint, t.amount, 1::bigint
  FROM transactions t JOIN users u ON u.id=t.destination_user_id AND u.role='MERCHANT'
  WHERE t.status IN ('SUCCESS','COMPLETED') AND t.transaction_type IN ('PAYMENT','TRANSFER')
    AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'
    AND t.created_at >= $1 AND t.created_at < $2
    AND ($3::uuid IS NULL OR u.id=$3) AND ($4::text IS NULL OR t.transaction_type::text=$4)
), totals AS (
  SELECT coalesce(sum(revenue),0) revenue,coalesce(sum(gross),0) gross,coalesce(sum(tx_count),0) transactions FROM events
), type_totals AS (
  SELECT types.type, coalesce(sum(e.revenue),0) revenue,coalesce(sum(e.gross),0) gross,coalesce(sum(e.tx_count),0) transactions
  FROM (VALUES ('PAYMENT'),('TRANSFER')) types(type) LEFT JOIN events e ON e.type=types.type
  GROUP BY types.type
), bucket_totals AS (
  SELECT bucket,sum(revenue) revenue,sum(gross) gross,sum(tx_count) transactions FROM events GROUP BY bucket
), buckets AS (
  SELECT generate_series(date_trunc($5,$1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'),
    date_trunc($5,($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
    CASE $5 WHEN 'quarter' THEN interval '3 months' WHEN 'year' THEN interval '1 year'
      WHEN 'month' THEN interval '1 month' WHEN 'week' THEN interval '1 week' ELSE interval '1 day' END) bucket
), series AS (
  SELECT to_char(b.bucket,'YYYY-MM-DD') bucket,coalesce(t.revenue,0) revenue,
    coalesce(t.gross,0) gross,coalesce(t.transactions,0) transactions
  FROM buckets b LEFT JOIN bucket_totals t USING(bucket)
), merchant_totals AS (
  SELECT e.merchant_id,u.full_name merchant_name,sum(e.revenue) revenue,sum(e.gross) gross,sum(e.tx_count) transactions
  FROM events e JOIN users u ON u.id=e.merchant_id GROUP BY e.merchant_id,u.full_name
), merchant_page AS (
  SELECT * FROM merchant_totals ORDER BY revenue DESC,merchant_id LIMIT $6 OFFSET $7
), gateway AS (
  SELECT count(*) total,
    count(*) FILTER(WHERE pr.status IN ('SUCCESS','PAID')) success,
    count(*) FILTER(WHERE pr.status='PENDING') pending,
    count(*) FILTER(WHERE pr.status='EXPIRED') expired,
    count(*) FILTER(WHERE pr.status='FAILED') failed,
    count(*) FILTER(WHERE pr.status='CANCELLED') cancelled
  FROM payment_requests pr JOIN users u ON u.id=pr.destination_user_id AND u.role='MERCHANT'
  WHERE pr.order_id IS NOT NULL AND pr.created_at >= $1 AND pr.created_at < $2
    AND ($3::uuid IS NULL OR u.id=$3)
)
SELECT jsonb_build_object(
  'overview',(SELECT to_jsonb(t) FROM totals t),
  'breakdown',(SELECT jsonb_agg(to_jsonb(t) ORDER BY type) FROM type_totals t),
  'timeseries',(SELECT jsonb_agg(to_jsonb(s) ORDER BY bucket) FROM series s),
  'merchants',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY revenue DESC,merchant_id) FROM merchant_page m),'[]'::jsonb),
  'total_merchants',(SELECT count(*) FROM merchant_totals),
  'gateway',(SELECT to_jsonb(g) FROM gateway g)
) data`,

  async getReportCutoff(db = pool) {
    return ensureReportRollupConsistent(db);
  },

  async queryFeeRevenueSummary(db = pool, filters, rollupUntil) {
    return with42P01Fallback(
      rollupUntil,
      (cutoff) => queryFeeRevenueSummary(db, filters, cutoff),
      () => queryFeeRevenueSummary(db, filters, null),
    );
  },

  async queryMerchantsPage(db = pool, filters, rollupUntil, opts) {
    return with42P01Fallback(
      rollupUntil,
      (cutoff) => queryMerchantsPage(db, filters, cutoff, opts),
      () => queryMerchantsPage(db, filters, null, opts),
    );
  },

  async queryReportFull(db = pool, filters, rollupUntil, opts) {
    return with42P01Fallback(
      rollupUntil,
      (cutoff) => queryReportFull(db, filters, cutoff, opts),
      () => queryReportFull(db, filters, null, opts),
    );
  },

  async getGrowthData(db = pool, filters, previous) {
    const dashRollupUntil = filters.merchant
      ? null
      : await ensureDashboardRollupConsistent(db);

    const [accountsResult, volume] = await Promise.all([
      db.query(
        `SELECT role,
           count(*) FILTER(WHERE created_at >= ($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS current,
           count(*) FILTER(WHERE created_at >= ($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')
             AND created_at < ($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS previous,
           count(*)::int AS total
         FROM users
         WHERE role IN ('USER','MERCHANT') AND ($4='ALL' OR role=$4)
           AND created_at < ($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')
         GROUP BY role`,
        [filters.startInstant, filters.nextDayInstant, previous, filters.role],
      ),
      with42P01Fallback(
        dashRollupUntil,
        (cutoff) => queryGrowthVolume(db, filters, previous, cutoff),
        () => queryGrowthVolume(db, filters, previous, null),
      ),
    ]);

    return { accountsRows: accountsResult.rows, volume };
  },
};

module.exports = adminReportsRepository;
