const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { Pool } = require("pg");

const { REPORT_SQL, filters: parseFilters } = require("../src/admin/reports/reports.service");
const { computeHybridWindow } = require("../src/admin/dashboard/dashboardRollup");
const {
  cashflow: rawCashflow,
  fees: rawFees,
  systemSeries: rawSystemSeries,
  controls: rawControls,
} = require("../src/admin/reports/financialReport.repository");
const { previousRange, exactInteger, normalizeIntegers, percentChange } = require("../src/admin/reports/financialReport.data");
const { reconcile } = require("../src/admin/reports/financialReport.reconciliation");
const { buildWorkbook } = require("../src/admin/reports/financialReport.export");

function buildV2MerchantReportQuery(f, rollupUntil, { allMerchants = false } = {}) {
  const hybrid = computeHybridWindow(f.startInstant, f.nextDayInstant, rollupUntil);
  const params = [];
  const addParam = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  const feeBranches = [];
  const txBranches = [];

  if (hybrid.useRollup) {
    const rs = addParam(f.startInstant);
    const re = addParam(hybrid.splitInstant);
    const conds = [
      `bucket_day >= (${rs}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
      `bucket_day < (${re}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
    ];
    if (f.merchant) conds.push(`merchant_id = ${addParam(f.merchant)}::uuid`);
    if (f.type) conds.push(`transaction_type = ${addParam(f.type)}`);
    else conds.push(`transaction_type IN ('PAYMENT', 'TRANSFER')`);

    const whereClause = conds.join(" AND ");
    feeBranches.push(`
      SELECT (bucket_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
             merchant_id, transaction_type AS type, fee_amount::numeric AS revenue
      FROM public.report_merchant_financial_daily
      WHERE ${whereClause} AND fee_amount <> 0
    `);
    txBranches.push(`
      SELECT (bucket_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
             merchant_id, transaction_type AS type, tx_amount::numeric AS gross, tx_count::bigint AS tx_count
      FROM public.report_merchant_financial_daily
      WHERE ${whereClause} AND tx_count <> 0
    `);
  }

  if (hybrid.useTail) {
    const ts = addParam(hybrid.splitInstant);
    const te = addParam(f.nextDayInstant);

    const feeConds = [
      `l.fee_type = 'QR_FEE'`,
      `l.transaction_id IS NOT NULL`,
      `t.status IN ('SUCCESS', 'COMPLETED')`,
      `COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'`,
      f.type ? `t.transaction_type = ${addParam(f.type)}` : `t.transaction_type IN ('PAYMENT', 'TRANSFER')`,
      `l.created_at >= ${ts}`,
      `l.created_at < ${te}`,
    ];
    if (f.merchant) feeConds.push(`t.destination_user_id = ${addParam(f.merchant)}::uuid`);

    feeBranches.push(`
      SELECT l.created_at AS bucket_ts, u.id AS merchant_id, t.transaction_type::text AS type, l.amount::numeric AS revenue
      FROM public.fee_ledger_entries l
      JOIN public.transactions t ON t.id = l.transaction_id
      JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
      WHERE ${feeConds.join(" AND ")}
    `);

    const txConds = [
      `t.status IN ('SUCCESS', 'COMPLETED')`,
      `COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'`,
      f.type ? `t.transaction_type = ${addParam(f.type)}` : `t.transaction_type IN ('PAYMENT', 'TRANSFER')`,
      `t.created_at >= ${ts}`,
      `t.created_at < ${te}`,
    ];
    if (f.merchant) txConds.push(`t.destination_user_id = ${addParam(f.merchant)}::uuid`);

    txBranches.push(`
      SELECT t.created_at AS bucket_ts, u.id AS merchant_id, t.transaction_type::text AS type, t.amount::numeric AS gross, 1::bigint AS tx_count
      FROM public.transactions t
      JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
      WHERE ${txConds.join(" AND ")}
    `);
  }

  const gwConds = [`pr.order_id IS NOT NULL`, `pr.created_at >= ${addParam(f.startInstant)}`, `pr.created_at < ${addParam(f.nextDayInstant)}`];
  if (f.merchant) gwConds.push(`pr.destination_user_id = ${addParam(f.merchant)}::uuid`);

  const groupParam = addParam(f.group);
  const startParam = addParam(f.startInstant);
  const endParam = addParam(f.nextDayInstant);
  const limitParam = addParam(allMerchants ? null : f.limit);
  const offsetParam = addParam(allMerchants ? 0 : (f.page - 1) * f.limit);

  const sql = `
    WITH fee_rows AS (
      ${feeBranches.join("\n UNION ALL \n") || "SELECT NULL::timestamptz AS bucket_ts, NULL::uuid AS merchant_id, NULL::text AS type, 0::numeric AS revenue WHERE false"}
    ),
    tx_rows AS (
      ${txBranches.join("\n UNION ALL \n") || "SELECT NULL::timestamptz AS bucket_ts, NULL::uuid AS merchant_id, NULL::text AS type, 0::numeric AS gross, 0::bigint AS tx_count WHERE false"}
    ),
    fee_by_type AS (SELECT type, SUM(revenue)::bigint AS revenue FROM fee_rows GROUP BY type),
    tx_by_type AS (SELECT type, SUM(gross)::bigint AS gross, SUM(tx_count)::bigint AS transactions FROM tx_rows GROUP BY type),
    breakdown_rows AS (
      SELECT types.type, COALESCE(f.revenue,0)::bigint AS revenue, COALESCE(t.gross,0)::bigint AS gross, COALESCE(t.transactions,0)::bigint AS transactions
      FROM (VALUES ('PAYMENT'),('TRANSFER')) AS types(type)
      LEFT JOIN fee_by_type f ON f.type = types.type
      LEFT JOIN tx_by_type t ON t.type = types.type
    ),
    totals AS (
      SELECT COALESCE(SUM(revenue),0)::bigint AS revenue, COALESCE(SUM(gross),0)::bigint AS gross, COALESCE(SUM(transactions),0)::bigint AS transactions
      FROM breakdown_rows
    ),
    fee_buckets AS (
      SELECT date_trunc(${groupParam}, bucket_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket, SUM(revenue)::bigint AS revenue
      FROM fee_rows GROUP BY 1
    ),
    tx_buckets AS (
      SELECT date_trunc(${groupParam}, bucket_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket, SUM(gross)::bigint AS gross, SUM(tx_count)::bigint AS transactions
      FROM tx_rows GROUP BY 1
    ),
    buckets AS (
      SELECT generate_series(
        date_trunc(${groupParam}, ${startParam}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'),
        date_trunc(${groupParam}, (${endParam}::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
        CASE ${groupParam} WHEN 'quarter' THEN interval '3 months' WHEN 'year' THEN interval '1 year' WHEN 'month' THEN interval '1 month' WHEN 'week' THEN interval '1 week' ELSE interval '1 day' END
      ) AS bucket
    ),
    series AS (
      SELECT to_char(b.bucket, 'YYYY-MM-DD') AS bucket, COALESCE(fb.revenue,0)::bigint AS revenue, COALESCE(tb.gross,0)::bigint AS gross, COALESCE(tb.transactions,0)::bigint AS transactions
      FROM buckets b LEFT JOIN fee_buckets fb ON fb.bucket = b.bucket LEFT JOIN tx_buckets tb ON tb.bucket = b.bucket
    ),
    fee_merchants AS (SELECT merchant_id, SUM(revenue)::bigint AS revenue FROM fee_rows GROUP BY merchant_id),
    tx_merchants AS (SELECT merchant_id, SUM(gross)::bigint AS gross, SUM(tx_count)::bigint AS transactions FROM tx_rows GROUP BY merchant_id),
    merchant_totals AS (
      SELECT COALESCE(fm.merchant_id, tm.merchant_id) AS merchant_id, COALESCE(fm.revenue,0)::bigint AS revenue, COALESCE(tm.gross,0)::bigint AS gross, COALESCE(tm.transactions,0)::bigint AS transactions
      FROM fee_merchants fm FULL OUTER JOIN tx_merchants tm ON fm.merchant_id = tm.merchant_id
    ),
    merchant_page AS (
      SELECT mt.merchant_id, u.full_name AS merchant_name, mt.revenue, mt.gross, mt.transactions
      FROM merchant_totals mt JOIN public.users u ON u.id = mt.merchant_id
      ORDER BY mt.revenue DESC, mt.merchant_id
      LIMIT ${limitParam} OFFSET ${offsetParam}
    ),
    gateway AS (
      SELECT
        COALESCE(SUM(t.total), 0)::bigint AS total,
        COALESCE(SUM(t.success), 0)::bigint AS success,
        COALESCE(SUM(t.pending), 0)::bigint AS pending,
        COALESCE(SUM(t.expired), 0)::bigint AS expired,
        COALESCE(SUM(t.failed), 0)::bigint AS failed,
        COALESCE(SUM(t.cancelled), 0)::bigint AS cancelled
      FROM (
        SELECT
          pr.destination_user_id,
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS', 'PAID'))::bigint AS success,
          COUNT(*) FILTER (WHERE pr.status = 'PENDING')::bigint AS pending,
          COUNT(*) FILTER (WHERE pr.status = 'EXPIRED')::bigint AS expired,
          COUNT(*) FILTER (WHERE pr.status = 'FAILED')::bigint AS failed,
          COUNT(*) FILTER (WHERE pr.status = 'CANCELLED')::bigint AS cancelled
        FROM public.payment_requests pr
        WHERE ${gwConds.join(" AND ")}
        GROUP BY pr.destination_user_id
      ) t
      JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
    )
    SELECT jsonb_build_object(
      'overview', (SELECT to_jsonb(t) FROM totals t),
      'breakdown', (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.type) FROM breakdown_rows b),
      'timeseries', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.bucket) FROM series s),
      'merchants', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.revenue DESC, m.merchant_id) FROM merchant_page m), '[]'::jsonb),
      'total_merchants', (SELECT COUNT(*)::bigint FROM merchant_totals),
      'gateway', (SELECT to_jsonb(g) FROM gateway g)
    ) AS data
  `;
  return { sql, params };
}

async function queryV2Cashflow(db, f, dashUntil) {
  const hybrid = computeHybridWindow(f.startInstant, f.nextDayInstant, dashUntil);
  const params = [];
  const addParam = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const parts = [];
  if (hybrid.useRollup) {
    const s = addParam(f.startInstant);
    const e = addParam(hybrid.splitInstant);
    parts.push(`
      SELECT transaction_type AS type,
             SUM(tx_count)::bigint AS total,
             SUM(tx_count) FILTER (WHERE UPPER(status) IN ('SUCCESS','COMPLETED'))::bigint AS success,
             SUM(tx_count) FILTER (WHERE UPPER(status) = 'PENDING')::bigint AS pending,
             SUM(tx_count) FILTER (WHERE UPPER(status) = 'FAILED')::bigint AS failed,
             SUM(tx_count) FILTER (WHERE UPPER(status) NOT IN ('SUCCESS','COMPLETED','PENDING','FAILED'))::bigint AS other,
             COALESCE(SUM(total_amount) FILTER (WHERE UPPER(status) IN ('SUCCESS','COMPLETED')), 0)::bigint AS gross
      FROM public.dashboard_tx_hourly
      WHERE bucket_hour >= ${s} AND bucket_hour < ${e}
      GROUP BY 1
    `);
  }
  if (hybrid.useTail) {
    const s = addParam(hybrid.splitInstant);
    const e = addParam(f.nextDayInstant);
    parts.push(`
      SELECT CASE WHEN transaction_type='TRANSFER' AND COALESCE(fee_rate_snapshot->>'operation_type','')='REVERSAL' THEN 'TRANSFER_REVERSAL' ELSE transaction_type::text END AS type,
             COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE status IN ('SUCCESS','COMPLETED'))::bigint AS success,
             COUNT(*) FILTER (WHERE status='PENDING')::bigint AS pending,
             COUNT(*) FILTER (WHERE status='FAILED')::bigint AS failed,
             COUNT(*) FILTER (WHERE status NOT IN ('SUCCESS','COMPLETED','PENDING','FAILED'))::bigint AS other,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('SUCCESS','COMPLETED')),0)::bigint AS gross
      FROM public.transactions WHERE created_at >= ${s} AND created_at < ${e}
      GROUP BY 1
    `);
  }
  const { rows } = await db.query(`
    SELECT type,
           SUM(total)::bigint AS total, SUM(success)::bigint AS success,
           SUM(pending)::bigint AS pending, SUM(failed)::bigint AS failed,
           SUM(other)::bigint AS other, SUM(gross)::bigint AS gross
    FROM (${parts.join(" UNION ALL ")}) u
    GROUP BY type ORDER BY type
  `, params);
  const out = rows.map((r) => ({
    type: r.type,
    total: Number(r.total),
    success: Number(r.success),
    pending: Number(r.pending),
    failed: Number(r.failed),
    other: Number(r.other),
    gross: Number(r.gross),
  }));
  for (const t of ["TOPUP", "WITHDRAW", "TRANSFER", "PAYMENT"]) {
    if (!out.some((r) => r.type === t)) out.push({ type: t, total: 0, success: 0, pending: 0, failed: 0, other: 0, gross: 0 });
  }
  return out;
}

async function queryV2MerchantFeeSeries(db, f, reportUntil) {
  const hybrid = computeHybridWindow(f.startInstant, f.nextDayInstant, reportUntil);
  const params = [];
  const addParam = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const groupParam = addParam(f.group);
  const parts = [];
  if (hybrid.useRollup) {
    const s = addParam(f.startInstant);
    const e = addParam(hybrid.splitInstant);
    const conds = [
      `bucket_day >= (${s}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
      `bucket_day < (${e}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
      f.type ? `transaction_type = ${addParam(f.type)}` : `transaction_type IN ('PAYMENT','TRANSFER')`,
    ];
    if (f.merchant) conds.push(`merchant_id = ${addParam(f.merchant)}::uuid`);
    parts.push(`
      SELECT date_trunc(${groupParam}, bucket_day::timestamp)::date AS b_date,
             COALESCE(SUM(fee_amount) FILTER (WHERE transaction_type='PAYMENT'),0)::bigint AS payment_fee,
             COALESCE(SUM(fee_amount) FILTER (WHERE transaction_type='TRANSFER'),0)::bigint AS transfer_fee
      FROM public.report_merchant_financial_daily
      WHERE ${conds.join(" AND ")}
      GROUP BY 1
    `);
  }
  if (hybrid.useTail) {
    const s = addParam(hybrid.splitInstant);
    const e = addParam(f.nextDayInstant);
    const conds = [
      `l.fee_type='QR_FEE'`, `t.status IN ('SUCCESS','COMPLETED')`, `COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'`,
      `u.role='MERCHANT'`, `l.created_at >= ${s}`, `l.created_at < ${e}`,
      f.type ? `t.transaction_type = ${addParam(f.type)}` : `t.transaction_type IN ('PAYMENT','TRANSFER')`,
    ];
    if (f.merchant) conds.push(`t.destination_user_id = ${addParam(f.merchant)}::uuid`);
    parts.push(`
      SELECT date_trunc(${groupParam}, l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS b_date,
             COALESCE(SUM(l.amount) FILTER (WHERE t.transaction_type='PAYMENT'),0)::bigint AS payment_fee,
             COALESCE(SUM(l.amount) FILTER (WHERE t.transaction_type='TRANSFER'),0)::bigint AS transfer_fee
      FROM public.fee_ledger_entries l JOIN public.transactions t ON t.id=l.transaction_id JOIN public.users u ON u.id=t.destination_user_id
      WHERE ${conds.join(" AND ")}
      GROUP BY 1
    `);
  }
  const { rows } = await db.query(`
    SELECT to_char(b_date, 'YYYY-MM-DD') AS bucket,
           SUM(payment_fee)::bigint AS payment_fee,
           SUM(transfer_fee)::bigint AS transfer_fee
    FROM (${parts.join(" UNION ALL ")}) u
    GROUP BY b_date ORDER BY b_date
  `, params);
  return rows.map((r) => ({ bucket: r.bucket, payment_fee: Number(r.payment_fee), transfer_fee: Number(r.transfer_fee) }));
}

function compareWorkbooks9Sheets(wbA, wbB) {
  if (wbA.worksheets.length !== 9 || wbB.worksheets.length !== 9) {
    throw new Error(`Expected 9 sheets, got A=${wbA.worksheets.length}, B=${wbB.worksheets.length}`);
  }
  const diffs = [];
  for (let i = 0; i < 9; i += 1) {
    const sA = wbA.worksheets[i];
    const sB = wbB.worksheets[i];
    if (sA.name !== sB.name) diffs.push(`Sheet ${i} name diff: ${sA.name} vs ${sB.name}`);
    if (sA.rowCount !== sB.rowCount) {
      diffs.push(`Sheet ${sA.name} rowCount diff: ${sA.rowCount} vs ${sB.rowCount}`);
      continue;
    }
    for (let r = 1; r <= sA.rowCount; r += 1) {
      const rowA = sA.getRow(r);
      const rowB = sB.getRow(r);
      const maxCol = Math.max(rowA.cellCount, rowB.cellCount);
      for (let c = 1; c <= maxCol; c += 1) {
        const vA = rowA.getCell(c).value;
        const vB = rowB.getCell(c).value;
        if (JSON.stringify(vA) !== JSON.stringify(vB)) {
          diffs.push(`Sheet ${sA.name} R${r}C${c} diff: ${JSON.stringify(vA)} vs ${JSON.stringify(vB)}`);
        }
      }
    }
  }
  return diffs;
}

async function main() {
  const targetDb = process.env.BENCH_DB_NAME || process.env.DB_NAME;
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: targetDb,
    max: 6,
  });

  try {
    const info = await pool.query(`
      SELECT
        (SELECT rollup_until FROM public.aggregation_rollup_state WHERE domain = 'dashboard') AS dash_until,
        (SELECT rollup_until FROM public.aggregation_rollup_state WHERE domain = 'report_merchant') AS rep_until,
        (SELECT to_char(MAX(bucket_day), 'YYYY-MM-DD') FROM public.report_merchant_financial_daily) AS max_day,
        (SELECT id FROM public.users WHERE role = 'MERCHANT' ORDER BY id LIMIT 1) AS m1,
        (SELECT id FROM public.users WHERE role = 'ADMIN' LIMIT 1) AS admin_id
    `);
    const { dash_until, rep_until, max_day, m1 } = info.rows[0];

    // Add a half-open tail test by choosing a simulated cutoff midway across active data
    const endDate = max_day; // active closed day from dataset, e.g. '2026-11-12' or '2026-11-18'
    const midCutoff = new Date(new Date(`${endDate}T00:00:00+07:00`).getTime() - 2 * 24 * 3600 * 1000); // 2 days before endDate

    const cases = [
      { label: "1d_day_ALL", input: { start_date: endDate, end_date: endDate, group_by: "day" }, cut: rep_until },
      { label: "7d_day_ALL_cross_cutoff", input: { start_date: toVnMinus(endDate, 6), end_date: endDate, group_by: "day" }, cut: midCutoff },
      { label: "30d_week_ALL", input: { start_date: toVnMinus(endDate, 29), end_date: endDate, group_by: "week" }, cut: rep_until },
      { label: "90d_month_MERCHANT", input: { start_date: toVnMinus(endDate, 89), end_date: endDate, group_by: "month", merchant_id: m1 }, cut: rep_until },
      { label: "1y_quarter_TRANSFER", input: { start_date: toVnMinus(endDate, 364), end_date: endDate, group_by: "quarter", transaction_type: "TRANSFER" }, cut: rep_until },
      { label: "1y_year_PAYMENT", input: { start_date: toVnMinus(endDate, 364), end_date: endDate, group_by: "year", transaction_type: "PAYMENT" }, cut: rep_until },
      { label: "1y_month_ALL", input: { start_date: toVnMinus(endDate, 364), end_date: endDate, group_by: "month" }, cut: rep_until },
    ];

    function toVnMinus(baseYmd, days) {
      const d = new Date(`${baseYmd}T00:00:00+07:00`);
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
        new Date(d.getTime() - days * 86400000)
      );
    }

    const reportSummary = [];
    for (const c of cases) {
      const f = parseFilters(c.input);
      const { sql, params } = buildV2MerchantReportQuery(f, c.cut, { allMerchants: true });
      const [v2Res, rawRes] = await Promise.all([
        pool.query(sql, params),
        pool.query(REPORT_SQL, [f.startInstant, f.nextDayInstant, f.merchant, f.type, f.group, null, 0]),
      ]);
      const v2Data = v2Res.rows[0].data;
      const rawData = rawRes.rows[0].data;

      if (JSON.stringify(v2Data) !== JSON.stringify(rawRes.rows[0].data)) {
        throw new Error(`JSON Parity mismatch on ${c.label}!\nv2 overview=${JSON.stringify(v2Data.overview)}\nraw overview=${JSON.stringify(rawData.overview)}`);
      }
      reportSummary.push({
        label: c.label,
        revenue: v2Data.overview.revenue,
        gross: v2Data.overview.gross,
        transactions: v2Data.overview.transactions,
        merchants: v2Data.total_merchants,
        gwTotal: v2Data.gateway.total,
        jsonParity: "100%_EXACT",
      });
    }

    // Full 9-sheet Excel workbook parity check across cross-cutoff 7d window + 30d window
    const excelCases = [
      { label: "Excel_7d_cross_cutoff", input: { start_date: toVnMinus(endDate, 6), end_date: endDate, group_by: "day" }, repCut: midCutoff, dashCut: midCutoff },
      { label: "Excel_30d_full_rollup", input: { start_date: toVnMinus(endDate, 29), end_date: endDate, group_by: "week" }, repCut: rep_until, dashCut: dash_until },
    ];
    for (const ec of excelCases) {
      const f = parseFilters(ec.input);
      const prev = previousRange(f);
      const fixedTs = "2026-11-19T12:00:00.000Z";
      const sharedMeta = {
        admin_id: info.rows[0].admin_id || "00000000-0000-0000-0000-000000000001",
        admin_name: "Admin Parity Check",
        financial_snapshot_at: fixedTs,
        generated_at: fixedTs,
        report_id: "00000000-0000-7000-8000-000000000001",
      };
      const growthStub = {
        accounts: [
          { role: "USER", current: 10, previous: 5, total: 100, growth: 100 },
          { role: "MERCHANT", current: 2, previous: 2, total: 20, growth: 0 },
        ],
        transactions: { current_count: 10, previous_count: 5, current_gross: 1000, previous_gross: 500 },
      };
      const loginsStub = { available: true, summary: { total_logins: 5, unique_users: 3 }, read_started_at: fixedTs, read_completed_at: fixedTs };

      const v2FullSql = buildV2MerchantReportQuery(f, ec.repCut, { allMerchants: true });
      const rawFull = await pool.query(REPORT_SQL, [f.startInstant, f.nextDayInstant, f.merchant, f.type, f.group, null, 0]);
      const v2Full = await pool.query(v2FullSql.sql, v2FullSql.params);

      const rawData = {
        merchant: normalizeIntegers(rawFull.rows[0].data),
        merchant_fee_series: (await pool.query(`
          SELECT to_char(date_trunc($3,l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'),'YYYY-MM-DD') bucket,
                 COALESCE(sum(l.amount) FILTER (WHERE t.transaction_type='PAYMENT'),0)::bigint payment_fee,
                 COALESCE(sum(l.amount) FILTER (WHERE t.transaction_type='TRANSFER'),0)::bigint transfer_fee
          FROM fee_ledger_entries l JOIN transactions t ON t.id=l.transaction_id JOIN users u ON u.id=t.destination_user_id
          WHERE l.created_at >= $1 AND l.created_at < $2 AND l.fee_type='QR_FEE' AND t.status IN ('SUCCESS','COMPLETED')
            AND u.role='MERCHANT' AND t.transaction_type IN ('PAYMENT','TRANSFER') AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'
          GROUP BY 1 ORDER BY 1
        `, [f.startInstant, f.nextDayInstant, f.group])).rows.map((r) => ({ bucket: r.bucket, payment_fee: Number(r.payment_fee), transfer_fee: Number(r.transfer_fee) })),
        cashflow: await rawCashflow(pool, f),
        previous_cashflow: await rawCashflow(pool, prev),
        fees: await rawFees(pool, f),
        previous_fees: await rawFees(pool, prev),
        system_series: await rawSystemSeries(pool, f),
        controls: await rawControls(pool, f),
        growth: growthStub,
        logins: loginsStub,
        metadata: sharedMeta,
        period: f.period,
        filters: { merchant_id: null, transaction_type: "ALL", role: "ALL" },
        previous_period: { start: prev.startInstant, end_exclusive: prev.nextDayInstant },
      };

      const v2Data = {
        ...rawData,
        merchant: normalizeIntegers(v2Full.rows[0].data),
        merchant_fee_series: await queryV2MerchantFeeSeries(pool, f, ec.repCut),
        cashflow: await queryV2Cashflow(pool, f, ec.dashCut),
        previous_cashflow: await queryV2Cashflow(pool, prev, ec.dashCut),
      };

      rawData.reconciliation = reconcile(rawData);
      v2Data.reconciliation = reconcile(v2Data);

      const wbRaw = await buildWorkbook(rawData);
      const wbV2 = await buildWorkbook(v2Data);
      const diffs = compareWorkbooks9Sheets(wbV2, wbRaw);
      if (diffs.length > 0) {
        throw new Error(`Excel 9-sheet parity failed for ${ec.label}:\n${diffs.slice(0, 10).join("\n")}`);
      }
      reportSummary.push({
        label: ec.label,
        sheetsVerified: wbV2.worksheets.length,
        excelCellDiffs: 0,
        jsonParity: "9_SHEETS_100%_EXACT",
      });
    }

    // Dashboard Q1/Q2/Q6 + 16:00Z/17:00Z (23:59:59+07 vs 00:00:00+07) + status breakdown parity vs raw transactions
    const boundaryEnd = new Date(`${endDate}T00:00:00+07:00`); // = 17:00:00Z previous UTC day
    const boundary1dEnd = new Date(boundaryEnd.getTime() + 86400000);
    const dashWindows = [
      { label: "Dashboard_Boundary_VN_Day_16Z_17Z", s: boundaryEnd, e: boundary1dEnd, unit: "hour" },
      { label: "Dashboard_7d_Day", s: new Date(boundary1dEnd.getTime() - 7 * 86400000), e: boundary1dEnd, unit: "day" },
      { label: "Dashboard_30d_Day_WithStatus", s: new Date(boundary1dEnd.getTime() - 30 * 86400000), e: boundary1dEnd, unit: "day" },
    ];
    for (const dw of dashWindows) {
      const split = dw.e <= dash_until ? dw.e : (dash_until > dw.s ? dash_until : dw.s);
      const v2Dash = await pool.query(
        `
        WITH rows AS (
          SELECT bucket_hour AS ts, transaction_type::text AS type, status::text AS status, tx_count, total_amount
          FROM public.dashboard_tx_hourly
          WHERE bucket_hour >= $1 AND bucket_hour < $2
          UNION ALL
          SELECT date_trunc('hour', created_at) AS ts, transaction_type::text, status::text, 1::bigint, amount::numeric(22,0)
          FROM public.transactions
          WHERE created_at >= $2 AND created_at < $3
        )
        SELECT date_trunc($4, ts AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
               type, UPPER(status) AS status,
               SUM(tx_count)::bigint AS cnt, SUM(total_amount)::bigint AS amt
        FROM rows GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
        `,
        [dw.s, split, dw.e, dw.unit]
      );
      const rawDash = await pool.query(
        `
        SELECT date_trunc($3, created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
               transaction_type::text AS type, UPPER(status) AS status,
               COUNT(*)::bigint AS cnt, COALESCE(SUM(amount), 0)::bigint AS amt
        FROM public.transactions
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
        `,
        [dw.s, dw.e, dw.unit]
      );
      if (JSON.stringify(v2Dash.rows) !== JSON.stringify(rawDash.rows)) {
        throw new Error(`Dashboard parity mismatch on ${dw.label}`);
      }
      reportSummary.push({
        label: dw.label,
        transactions: rawDash.rows.reduce((a, r) => a + Number(r.cnt), 0),
        gross: rawDash.rows.reduce((a, r) => a + Number(r.amt), 0),
        jsonParity: "100%_EXACT",
      });
    }

    // Explicit tx_count vs fee_tx_count & fee_ledger_entries parity (including TRANSFER 0-fee & boundary day)
    const txFeeParity = await pool.query(
      `
      WITH roll AS (
        SELECT bucket_day, transaction_type, SUM(tx_count)::bigint AS tx_count, SUM(tx_amount)::bigint AS tx_amount,
               SUM(fee_tx_count)::bigint AS fee_tx_count, SUM(fee_amount)::bigint AS fee_amount
        FROM public.report_merchant_financial_daily
        WHERE bucket_day >= ($1::date - 6) AND bucket_day <= $1::date
        GROUP BY 1, 2
      ),
      raw_tx AS (
        SELECT (t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_day, t.transaction_type::text,
               COUNT(*)::bigint AS tx_count, COALESCE(SUM(t.amount),0)::bigint AS tx_amount
        FROM public.transactions t
        JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
        WHERE t.created_at >= (($1::date - 6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND t.created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND t.status IN ('SUCCESS','COMPLETED') AND t.transaction_type IN ('PAYMENT','TRANSFER')
          AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'
        GROUP BY 1, 2
      ),
      raw_fee AS (
        SELECT (l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_day, t.transaction_type::text,
               COUNT(*)::bigint AS fee_tx_count, COALESCE(SUM(l.amount),0)::bigint AS fee_amount
        FROM public.fee_ledger_entries l
        JOIN public.transactions t ON t.id = l.transaction_id
        JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
        WHERE l.fee_type = 'QR_FEE'
          AND l.created_at >= (($1::date - 6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND l.created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND t.status IN ('SUCCESS','COMPLETED') AND t.transaction_type IN ('PAYMENT','TRANSFER')
          AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'
        GROUP BY 1, 2
      )
      SELECT COUNT(*)::int AS mismatched_buckets
      FROM roll r
      FULL OUTER JOIN raw_tx rt USING (bucket_day, transaction_type)
      FULL OUTER JOIN raw_fee rf USING (bucket_day, transaction_type)
      WHERE COALESCE(r.tx_count,0) <> COALESCE(rt.tx_count,0)
         OR COALESCE(r.tx_amount,0) <> COALESCE(rt.tx_amount,0)
         OR COALESCE(r.fee_tx_count,0) <> COALESCE(rf.fee_tx_count,0)
         OR COALESCE(r.fee_amount,0) <> COALESCE(rf.fee_amount,0)
      `,
      [endDate]
    );
    if (txFeeParity.rows[0].mismatched_buckets !== 0) {
      throw new Error(`Row-level tx_count/fee_tx_count mismatch count=${txFeeParity.rows[0].mismatched_buckets}`);
    }
    reportSummary.push({
      label: "Daily_Row_txCount_vs_feeTxCount_7d_Boundary",
      jsonParity: "100%_EXACT",
    });

    const outPath =
      "C:/Users/Admin/.gemini/antigravity/brain/176b17c8-0c8d-46e3-bb08-6af740b8f18b/scratch/phase4_parity_report.json";
    fs.writeFileSync(outPath, JSON.stringify({ db: targetDb, results: reportSummary }, null, 2));
    console.table(reportSummary);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
