const { queryReportFull } = require('./reportRollup');
const { exactInteger, normalizeIntegers, previousRange } = require('./financialReport.data');

// Accept a caller-owned connection: export can read all sections in one snapshot.
// No pool access or rollup maintenance is allowed in this repository.
async function merchantReport(db, filters) {
  return normalizeIntegers(await queryReportFull(db, filters, null, { allMerchants: true }));
}

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
  return rows.map(row => ({ ...row, ...Object.fromEntries(keys.map(key => [key, exactInteger(row[key])])) }));
}
async function cashflow(db, filters) {
  const { rows } = await db.query(`SELECT
    CASE
      WHEN transaction_type='TRANSFER' AND COALESCE(fee_rate_snapshot->>'operation_type','')='REVERSAL'
      THEN 'TRANSFER_REVERSAL'
      ELSE transaction_type::text
    END AS type,
    count(*) AS total,
    count(*) FILTER (WHERE status IN ${SUCCESS}) AS success,
    count(*) FILTER (WHERE status='PENDING') AS pending,
    count(*) FILTER (WHERE status='FAILED') AS failed,
    count(*) FILTER (WHERE status NOT IN ('SUCCESS','COMPLETED','PENDING','FAILED')) AS other,
    coalesce(sum(amount) FILTER (WHERE status IN ${SUCCESS}),0) AS gross
    FROM transactions WHERE created_at >= $1 AND created_at < $2
    GROUP BY 1 ORDER BY 1`, [filters.startInstant, filters.nextDayInstant]);
  const data = numericRows(rows, ['total','success','pending','failed','other','gross']);
  for (const type of ['TOPUP','WITHDRAW','TRANSFER','PAYMENT']) {
    if (!data.some(row => row.type === type)) data.push({ type, total:0, success:0, pending:0, failed:0, other:0, gross:0 });
  }
  return data;
}
async function fees(db, filters) {
  const { rows } = await db.query(`WITH source AS (${FEE_SOURCE})
    SELECT category, eligible, count(*) AS entries, coalesce(sum(amount),0) AS revenue
    FROM source GROUP BY category,eligible ORDER BY category,eligible`, [filters.startInstant, filters.nextDayInstant]);
  return numericRows(rows, ['entries','revenue']);
}

async function systemSeries(db, filters) {
  const { rows } = await db.query(`WITH fee_source AS (${FEE_SOURCE}),
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
        coalesce(sum(amount) FILTER (WHERE transaction_type='TRANSFER' AND fee_rate_snapshot->>'operation_type'='REVERSAL'),0) AS transfer_reversal
      FROM transactions WHERE created_at >= $1 AND created_at < $2 AND status IN ${SUCCESS} GROUP BY 1
    ), buckets AS (
      SELECT generate_series(date_trunc($3,$1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'),
        date_trunc($3,($2::timestamptz-interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
        CASE $3 WHEN 'year' THEN interval '1 year' WHEN 'quarter' THEN interval '3 months'
          WHEN 'month' THEN interval '1 month' WHEN 'week' THEN interval '1 week' ELSE interval '1 day' END) bucket
    ) SELECT to_char(b.bucket,'YYYY-MM-DD') AS bucket,
      coalesce(t.topup,0) AS topup, coalesce(t.withdraw,0) AS withdraw,
      coalesce(t.payment,0) AS payment, coalesce(t.transfer,0) AS transfer,
      coalesce(t.transfer_reversal,0) AS transfer_reversal,
      coalesce(t.transactions,0) AS transactions, coalesce(f.revenue,0) AS revenue,
      coalesce(f.qr_fee,0) AS qr_fee
    FROM buckets b LEFT JOIN tx_buckets t USING(bucket) LEFT JOIN fee_buckets f USING(bucket)
    ORDER BY b.bucket`, [filters.startInstant, filters.nextDayInstant, filters.group]);
  return numericRows(rows, ['topup','withdraw','payment','transfer','transfer_reversal','transactions','revenue','qr_fee']);
}

// Independent scalar aggregates provide evidence for reconciliation.
async function controls(db, filters) {
  const { rows } = await db.query(`WITH fee_source AS (${FEE_SOURCE})
    SELECT (SELECT coalesce(sum(amount),0)::text FROM fee_source WHERE eligible) AS revenue,
      (SELECT coalesce(sum(amount),0)::text FROM fee_source WHERE eligible AND fee_type='QR_FEE') AS qr_fee,
      (SELECT count(*)::text FROM transactions WHERE created_at >= $1 AND created_at < $2) AS transactions`,
  [filters.startInstant, filters.nextDayInstant]);
  return numericRows(rows, ['revenue','transactions','qr_fee'])[0];
}

async function merchantFeeSeries(db, filters) {
  const {rows}=await db.query(`SELECT to_char(date_trunc($3,l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'),'YYYY-MM-DD') bucket,
    coalesce(sum(l.amount) FILTER (WHERE t.transaction_type='PAYMENT'),0) payment_fee,
    coalesce(sum(l.amount) FILTER (WHERE t.transaction_type='TRANSFER'),0) transfer_fee
    FROM fee_ledger_entries l JOIN transactions t ON t.id=l.transaction_id JOIN users u ON u.id=t.destination_user_id
    WHERE l.created_at >= $1 AND l.created_at < $2 AND l.fee_type='QR_FEE' AND t.status IN ${SUCCESS}
      AND u.role='MERCHANT' AND t.transaction_type IN ('PAYMENT','TRANSFER')
      AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'
      AND ($4::uuid IS NULL OR t.destination_user_id=$4) AND ($5::text IS NULL OR t.transaction_type::text=$5)
    GROUP BY 1 ORDER BY 1`,[filters.startInstant,filters.nextDayInstant,filters.group,filters.merchant,filters.type]);
  return numericRows(rows,['payment_fee','transfer_fee']);
}

async function readFinancialData(db, filters) {
  const previous = previousRange(filters);
  // Sequential queries also work with a single transaction connection.
  return {
    merchant: await merchantReport(db, filters),
    merchant_fee_series: await merchantFeeSeries(db, filters),
    cashflow: await cashflow(db, filters),
    previous_cashflow: await cashflow(db, previous),
    fees: await fees(db, filters),
    previous_fees: await fees(db, previous),
    system_series: await systemSeries(db, filters),
    controls: await controls(db, filters),
  };
}
module.exports = { merchantReport, cashflow, fees, systemSeries, controls, readFinancialData };
