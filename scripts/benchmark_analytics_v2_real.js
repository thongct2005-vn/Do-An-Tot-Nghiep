const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { Pool } = require("pg");

const DEFAULT_OUT =
  "C:/Users/Admin/.gemini/antigravity/brain/176b17c8-0c8d-46e3-bb08-6af740b8f18b/scratch/phase4_benchmark_real_report.json";

function pctStats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return {
    runs: s.length,
    coldMs: Number(arr[0].toFixed(2)),
    p50Ms: Number(s[Math.floor((s.length - 1) * 0.5)].toFixed(2)),
    p95Ms: Number(s[Math.floor((s.length - 1) * 0.95)].toFixed(2)),
    maxMs: Number(s[s.length - 1].toFixed(2)),
  };
}

function walkPlan(node, acc = { heapFetches: 0, tempBlocks: 0, nodes: [] }) {
  if (!node) return acc;
  if (typeof node["Heap Fetches"] === "number") acc.heapFetches += node["Heap Fetches"];
  if (typeof node["Temp Written Blocks"] === "number") acc.tempBlocks += node["Temp Written Blocks"];
  acc.nodes.push(`${node["Node Type"]}${node["Relation Name"] ? `(${node["Relation Name"]})` : ""}${node["Index Name"] ? `[${node["Index Name"]}]` : ""}`);
  for (const child of node.Plans || []) walkPlan(child, acc);
  return acc;
}

async function benchQuery(pool, label, sql, params, runs = 5) {
  const client = await pool.connect();
  try {
    const times = [];
    let lastPlan = null;
    for (let i = 0; i < runs; i += 1) {
      const t0 = performance.now();
      const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
      const t1 = performance.now();
      times.push(t1 - t0);
      if (i === runs - 1) lastPlan = res.rows[0]["QUERY PLAN"][0];
    }
    const stats = pctStats(times);
    const meta = walkPlan(lastPlan.Plan);
    return {
      label,
      ...stats,
      execMs: Number(lastPlan["Execution Time"].toFixed(2)),
      heapFetches: meta.heapFetches,
      tempWrittenBlocks: meta.tempBlocks,
      topNodes: meta.nodes.slice(0, 6),
    };
  } finally {
    client.release();
  }
}

async function benchMultiQueryTotal(pool, label, queries, runs = 5) {
  const client = await pool.connect();
  try {
    const times = [];
    for (let i = 0; i < runs; i += 1) {
      const t0 = performance.now();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      for (const q of queries) {
        await client.query(q.sql, q.params);
      }
      await client.query("COMMIT");
      const t1 = performance.now();
      times.push(t1 - t0);
    }
    return { label, ...pctStats(times) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const targetDb = process.env.BENCH_DB_NAME || process.env.DB_NAME;
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: targetDb,
    max: 10,
  });

  try {
    const meta = await pool.query(`
      SELECT
        current_database() AS db,
        (SELECT rollup_until FROM public.aggregation_rollup_state WHERE domain = 'dashboard') AS dash_until,
        (SELECT rollup_until FROM public.aggregation_rollup_state WHERE domain = 'report_merchant') AS report_until,
        (SELECT to_char(MAX(bucket_day), 'YYYY-MM-DD') FROM public.report_merchant_financial_daily) AS max_day,
        (SELECT id FROM public.users WHERE role = 'MERCHANT' LIMIT 1) AS sample_merchant,
        (SELECT id FROM public.transactions ORDER BY created_at DESC LIMIT 1) AS sample_tx
    `);
    const { db, dash_until, report_until, max_day, sample_merchant, sample_tx } = meta.rows[0];
    console.log("Benchmarking DB:", db, "dashUntil:", dash_until, "reportUntil:", report_until, "maxDay:", max_day);

    // Anchor end_date on the latest full closed VN day with abundant data (report_until) or max_day
    const endDayRes = await pool.query(
      `SELECT to_char(LEAST($1::date, ((NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1)), 'YYYY-MM-DD') AS anchor_day`,
      [max_day]
    );
    const anchorDayStr = endDayRes.rows[0].anchor_day;
    const endDateInstant = new Date(`${anchorDayStr}T00:00:00+07:00`);
    const nextDayInstant = new Date(endDateInstant.getTime() + 24 * 3600 * 1000);
    const winStart = (days) => new Date(nextDayInstant.getTime() - days * 24 * 3600 * 1000);
    const toVnDate = (d) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);

    const results = {};

    // 1. Dashboard benchmarks (real table dashboard_tx_hourly) across 1d, 7d, 30d, 90d, 1y
    results.dashboard = [];
    for (const [label, days, unit] of [
      ["1d_hour", 1, "hour"],
      ["7d_day", 7, "day"],
      ["30d_day", 30, "day"],
      ["90d_week", 90, "week"],
      ["1y_month", 365, "month"],
    ]) {
      const s = winStart(days);
      const prevS = new Date(s.getTime() - (nextDayInstant.getTime() - s.getTime()));
      results.dashboard.push(
        await benchQuery(
          pool,
          `Q1_Dashboard_KPI_${label}`,
          `SELECT
             COALESCE(SUM(tx_count), 0)::int AS total_transactions,
             COALESCE(SUM(CASE WHEN UPPER(transaction_type)='TOPUP' AND UPPER(status) IN ('SUCCESS','COMPLETED') THEN total_amount ELSE 0 END), 0) AS total_topup,
             COALESCE(SUM(CASE WHEN UPPER(transaction_type)='WITHDRAW' AND UPPER(status) IN ('SUCCESS','COMPLETED') THEN total_amount ELSE 0 END), 0) AS total_withdraw,
             COALESCE(SUM(CASE WHEN UPPER(transaction_type)='PAYMENT' AND UPPER(status) IN ('SUCCESS','COMPLETED') THEN total_amount ELSE 0 END), 0) AS total_qr_payment,
             COALESCE(SUM(CASE WHEN UPPER(transaction_type)='TRANSFER' AND UPPER(status) IN ('SUCCESS','COMPLETED') THEN total_amount ELSE 0 END), 0) AS total_transfer
           FROM public.dashboard_tx_hourly
           WHERE bucket_hour >= $1 AND bucket_hour < $2`,
          [s, nextDayInstant]
        )
      );
      results.dashboard.push(
        await benchQuery(
          pool,
          `Q2_Dashboard_Series_${label}`,
          `SELECT
             DATE_TRUNC('${unit}', bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket_ts,
             COALESCE(SUM(CASE WHEN UPPER(transaction_type)='TOPUP' AND UPPER(status) IN ('SUCCESS','COMPLETED') THEN total_amount ELSE 0 END), 0) AS topup,
             COALESCE(SUM(CASE WHEN UPPER(transaction_type)='WITHDRAW' AND UPPER(status) IN ('SUCCESS','COMPLETED') THEN total_amount ELSE 0 END), 0) AS withdraw,
             COALESCE(SUM(CASE WHEN UPPER(transaction_type)='PAYMENT' AND UPPER(status) IN ('SUCCESS','COMPLETED') THEN total_amount ELSE 0 END), 0) AS qr_payment
           FROM public.dashboard_tx_hourly
           WHERE bucket_hour >= $1 AND bucket_hour < $2
           GROUP BY 1 ORDER BY 1 ASC`,
          [s, nextDayInstant]
        )
      );
      results.dashboard.push(
        await benchQuery(
          pool,
          `Q6_Growth_Volume_${label}`,
          `SELECT
             COALESCE(SUM(tx_count) FILTER (WHERE bucket_hour >= $2), 0)::bigint AS current_count,
             COALESCE(SUM(tx_count) FILTER (WHERE bucket_hour < $2), 0)::bigint AS previous_count,
             COALESCE(SUM(total_amount) FILTER (WHERE bucket_hour >= $2), 0)::bigint AS current_gross,
             COALESCE(SUM(total_amount) FILTER (WHERE bucket_hour < $2), 0)::bigint AS previous_gross
           FROM public.dashboard_tx_hourly
           WHERE UPPER(status) IN ('SUCCESS','COMPLETED')
             AND bucket_hour >= $1 AND bucket_hour < $3`,
          [prevS, s, nextDayInstant]
        )
      );
    }

    // 2. Report Q3/Q4/Merchants + Q7 Full Report across 1d..1y & day/week/month/quarter/year
    // Avoids materializing a 466k-row CTE tuplestore (`fin_rows`) by pre-aggregating (bucket, type) and scanning merchant_totals directly,
    // and pre-aggregates payment_requests by destination_user_id before joining users.
    const buildV2FullSql = (groupBy, allMerchants = false) => `
      WITH bucket_type_agg AS (
        SELECT date_trunc('${groupBy}', bucket_day::timestamp)::date AS bucket,
               transaction_type AS type,
               SUM(fee_amount)::bigint AS revenue,
               SUM(tx_amount)::bigint AS gross,
               SUM(tx_count)::bigint AS transactions
        FROM public.report_merchant_financial_daily
        WHERE bucket_day >= $1::date AND bucket_day <= $2::date
        GROUP BY 1, 2
      ),
      by_type AS (
        SELECT types.type,
               COALESCE(SUM(f.revenue), 0)::bigint AS revenue,
               COALESCE(SUM(f.gross), 0)::bigint AS gross,
               COALESCE(SUM(f.transactions), 0)::bigint AS transactions
        FROM (VALUES ('PAYMENT'), ('TRANSFER')) AS types(type)
        LEFT JOIN bucket_type_agg f ON f.type = types.type
        GROUP BY types.type
      ),
      totals AS (
        SELECT COALESCE(SUM(revenue), 0)::bigint AS revenue,
               COALESCE(SUM(gross), 0)::bigint AS gross,
               COALESCE(SUM(transactions), 0)::bigint AS transactions
        FROM by_type
      ),
      fin_buckets AS (
        SELECT bucket,
               SUM(revenue)::bigint AS revenue,
               SUM(gross)::bigint AS gross,
               SUM(transactions)::bigint AS transactions
        FROM bucket_type_agg
        GROUP BY 1
      ),
      buckets AS (
        SELECT generate_series(
          date_trunc('${groupBy}', $1::date::timestamp)::date,
          date_trunc('${groupBy}', $2::date::timestamp)::date,
          CASE '${groupBy}'
            WHEN 'quarter' THEN interval '3 months'
            WHEN 'year' THEN interval '1 year'
            WHEN 'month' THEN interval '1 month'
            WHEN 'week' THEN interval '1 week'
            ELSE interval '1 day'
          END
        )::date AS bucket
      ),
      series AS (
        SELECT to_char(b.bucket, 'YYYY-MM-DD') AS bucket,
               COALESCE(fb.revenue, 0)::bigint AS revenue,
               COALESCE(fb.gross, 0)::bigint AS gross,
               COALESCE(fb.transactions, 0)::bigint AS transactions
        FROM buckets b LEFT JOIN fin_buckets fb ON fb.bucket = b.bucket
      ),
      merchant_totals AS (
        SELECT merchant_id,
               SUM(fee_amount)::bigint AS revenue,
               SUM(tx_amount)::bigint AS gross,
               SUM(tx_count)::bigint AS transactions
        FROM public.report_merchant_financial_daily
        WHERE bucket_day >= $1::date AND bucket_day <= $2::date
        GROUP BY merchant_id
      ),
      merchant_page AS (
        SELECT mt.merchant_id, u.full_name AS merchant_name, mt.revenue, mt.gross, mt.transactions
        FROM merchant_totals mt
        JOIN public.users u ON u.id = mt.merchant_id
        ORDER BY mt.revenue DESC, mt.merchant_id
        ${allMerchants ? "" : "LIMIT 20 OFFSET 0"}
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
          WHERE pr.order_id IS NOT NULL
            AND pr.created_at >= $3 AND pr.created_at < $4
          GROUP BY pr.destination_user_id
        ) t
        JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
      )
      SELECT jsonb_build_object(
        'overview', (SELECT to_jsonb(t) FROM totals t),
        'breakdown', (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.type) FROM by_type b),
        'timeseries', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.bucket) FROM series s),
        'merchants', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.revenue DESC, m.merchant_id) FROM merchant_page m), '[]'::jsonb),
        'total_merchants', (SELECT COUNT(*)::bigint FROM merchant_totals),
        'gateway', (SELECT to_jsonb(g) FROM gateway g)
      ) AS data
    `;

    results.reports = [];
    for (const [label, days, groupBy] of [
      ["1d_day", 1, "day"],
      ["7d_day", 7, "day"],
      ["30d_day", 30, "day"],
      ["90d_week", 90, "week"],
      ["1y_day", 365, "day"],
      ["1y_week", 365, "week"],
      ["1y_month", 365, "month"],
      ["1y_quarter", 365, "quarter"],
      ["1y_year", 365, "year"],
    ]) {
      const s = winStart(days);
      const startVn = toVnDate(s);
      const endVn = anchorDayStr;
      if (["1d_day", "30d_day", "1y_month"].includes(label)) {
        results.reports.push(
          await benchQuery(
            pool,
            `Q3_Q4_KPI_${label}_v2`,
            `SELECT COALESCE(SUM(tx_count),0)::bigint AS tx_count,
                    COALESCE(SUM(tx_amount),0)::bigint AS gross,
                    COALESCE(SUM(fee_amount),0)::bigint AS revenue
             FROM public.report_merchant_financial_daily
             WHERE bucket_day >= $1::date AND bucket_day <= $2::date`,
            [startVn, endVn]
          )
        );
        results.reports.push(
          await benchQuery(
            pool,
            `Q_MerchantsPage_${label}_v2`,
            `WITH mt AS (
               SELECT merchant_id, SUM(fee_amount)::bigint AS revenue, SUM(tx_amount)::bigint AS gross, SUM(tx_count)::bigint AS transactions
               FROM public.report_merchant_financial_daily
               WHERE bucket_day >= $1::date AND bucket_day <= $2::date
               GROUP BY merchant_id
             ), p AS (SELECT *, COUNT(*) OVER()::int AS total_merchants FROM mt ORDER BY revenue DESC, merchant_id LIMIT 20 OFFSET 0)
             SELECT p.*, u.full_name FROM p JOIN public.users u ON u.id = p.merchant_id ORDER BY p.revenue DESC, p.merchant_id`,
            [startVn, endVn]
          )
        );
      }
      results.reports.push(
        await benchQuery(
          pool,
          `Q7_Full_Report_${label}_v2`,
          buildV2FullSql(groupBy, false),
          [startVn, endVn, s, nextDayInstant]
        )
      );
    }

    // 3. Export group & full 9-sheet workbook SQL comparison (v2 vs v1 real tables side-by-side!)
    results.export = [];
    const s1y = winStart(365);
    const start1yVn = toVnDate(s1y);
    for (const grp of ["day", "week", "month", "quarter", "year"]) {
      results.export.push(
        await benchQuery(
          pool,
          `Export_Group_${grp}_v1_fee_hourly`,
          `SELECT date_trunc('${grp}', bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
                  COALESCE(SUM(fee_amount), 0)::bigint AS revenue
           FROM public.report_merchant_fee_hourly
           WHERE bucket_hour >= $1 AND bucket_hour < $2
           GROUP BY 1 ORDER BY 1`,
          [s1y, nextDayInstant]
        )
      );
      results.export.push(
        await benchQuery(
          pool,
          `Export_Group_${grp}_v2_merged_daily`,
          `SELECT date_trunc('${grp}', bucket_day::timestamp)::date AS bucket,
                  COALESCE(SUM(fee_amount), 0)::bigint AS revenue,
                  COALESCE(SUM(tx_amount), 0)::bigint AS gross,
                  COALESCE(SUM(tx_count), 0)::bigint AS transactions
           FROM public.report_merchant_financial_daily
           WHERE bucket_day >= $1::date AND bucket_day <= $2::date
           GROUP BY 1 ORDER BY 1`,
          [start1yVn, anchorDayStr]
        )
      );
    }

    // Full 9-sheet Excel SQL queries (financialReport.repository.js readFinancialData equivalent) at 1y
    const prev1yStart = new Date(s1y.getTime() - (nextDayInstant.getTime() - s1y.getTime()));
    results.export.push(
      await benchMultiQueryTotal(pool, "Export_Full_9Sheets_SQL_1y_month_v2", [
        { sql: buildV2FullSql("month", true), params: [start1yVn, anchorDayStr, s1y, nextDayInstant] },
        {
          sql: `SELECT to_char(date_trunc('month', bucket_day::timestamp), 'YYYY-MM-DD') AS bucket,
                       COALESCE(SUM(fee_amount) FILTER (WHERE transaction_type='PAYMENT'),0)::bigint AS payment_fee,
                       COALESCE(SUM(fee_amount) FILTER (WHERE transaction_type='TRANSFER'),0)::bigint AS transfer_fee
                FROM public.report_merchant_financial_daily
                WHERE bucket_day >= $1::date AND bucket_day <= $2::date
                GROUP BY 1 ORDER BY 1`,
          params: [start1yVn, anchorDayStr],
        },
        {
          sql: `SELECT transaction_type::text AS type, SUM(tx_count)::bigint AS total,
                       SUM(tx_count) FILTER (WHERE UPPER(status) IN ('SUCCESS','COMPLETED'))::bigint AS success,
                       SUM(tx_count) FILTER (WHERE UPPER(status)='PENDING')::bigint AS pending,
                       SUM(tx_count) FILTER (WHERE UPPER(status)='FAILED')::bigint AS failed,
                       COALESCE(SUM(total_amount) FILTER (WHERE UPPER(status) IN ('SUCCESS','COMPLETED')),0)::bigint AS gross
                FROM public.dashboard_tx_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2 GROUP BY 1 ORDER BY 1`,
          params: [s1y, nextDayInstant],
        },
        {
          sql: `SELECT transaction_type::text AS type, SUM(tx_count)::bigint AS total,
                       SUM(tx_count) FILTER (WHERE UPPER(status) IN ('SUCCESS','COMPLETED'))::bigint AS success,
                       COALESCE(SUM(total_amount) FILTER (WHERE UPPER(status) IN ('SUCCESS','COMPLETED')),0)::bigint AS gross
                FROM public.dashboard_tx_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2 GROUP BY 1 ORDER BY 1`,
          params: [prev1yStart, s1y],
        },
        {
          sql: `SELECT l.fee_type, COUNT(*)::bigint AS entries, COALESCE(SUM(l.amount),0)::bigint AS revenue
                FROM public.fee_ledger_entries l LEFT JOIN public.transactions t ON t.id=l.transaction_id
                WHERE l.created_at >= $1 AND l.created_at < $2 GROUP BY 1 ORDER BY 1`,
          params: [s1y, nextDayInstant],
        },
        {
          sql: `SELECT l.fee_type, COUNT(*)::bigint AS entries, COALESCE(SUM(l.amount),0)::bigint AS revenue
                FROM public.fee_ledger_entries l LEFT JOIN public.transactions t ON t.id=l.transaction_id
                WHERE l.created_at >= $1 AND l.created_at < $2 GROUP BY 1 ORDER BY 1`,
          params: [prev1yStart, s1y],
        },
      ])
    );

    // 4. Gateway Q5 direct vs v1 + concurrent PENDING status update stress test
    const gwPreAggSql = `
      SELECT COALESCE(SUM(t.total), 0)::bigint AS total,
             COALESCE(SUM(t.success), 0)::bigint AS success,
             COALESCE(SUM(t.pending), 0)::bigint AS pending,
             COALESCE(SUM(t.expired), 0)::bigint AS expired,
             COALESCE(SUM(t.failed), 0)::bigint AS failed,
             COALESCE(SUM(t.cancelled), 0)::bigint AS cancelled
      FROM (
        SELECT pr.destination_user_id,
               COUNT(*)::bigint AS total,
               COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS', 'PAID'))::bigint AS success,
               COUNT(*) FILTER (WHERE pr.status = 'PENDING')::bigint AS pending,
               COUNT(*) FILTER (WHERE pr.status = 'EXPIRED')::bigint AS expired,
               COUNT(*) FILTER (WHERE pr.status = 'FAILED')::bigint AS failed,
               COUNT(*) FILTER (WHERE pr.status = 'CANCELLED')::bigint AS cancelled
        FROM public.payment_requests pr
        WHERE pr.order_id IS NOT NULL AND pr.created_at >= $1 AND pr.created_at < $2
        GROUP BY pr.destination_user_id
      ) t
      JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
    `;
    results.gateway = [];
    for (const [label, days] of [["1d", 1], ["7d", 7], ["30d", 30], ["1y", 365]]) {
      const s = winStart(days);
      results.gateway.push(
        await benchQuery(pool, `Q5_Gateway_${label}_Direct_WithUsersJoin`, gwPreAggSql, [s, nextDayInstant])
      );
      results.gateway.push(
        await benchQuery(
          pool,
          `Q5_Gateway_${label}_Direct_NoJoin`,
          `SELECT COUNT(*)::bigint AS total,
                  COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS', 'PAID'))::bigint AS success,
                  COUNT(*) FILTER (WHERE pr.status = 'PENDING')::bigint AS pending,
                  COUNT(*) FILTER (WHERE pr.status = 'EXPIRED')::bigint AS expired,
                  COUNT(*) FILTER (WHERE pr.status = 'FAILED')::bigint AS failed,
                  COUNT(*) FILTER (WHERE pr.status = 'CANCELLED')::bigint AS cancelled
           FROM public.payment_requests pr
           WHERE pr.order_id IS NOT NULL AND pr.created_at >= $1 AND pr.created_at < $2`,
          [s, nextDayInstant]
        )
      );
    }

    // Stress test: insert 200 synthetic PENDING gateway rows in [s30d, nextDayInstant), continuously update status while reading Q5!
    const stressIds = [];
    for (let i = 0; i < 200; i += 1) {
      stressIds.push(`STRESS_GW_${Date.now()}_${i}`);
    }
    await pool.query(
      `
      INSERT INTO public.payment_requests (id, reference_code, destination_user_id, amount, status, order_id, created_at)
      SELECT gen_random_uuid(), oid, $1::uuid, 50000, 'PENDING', oid, $2::timestamptz
      FROM unnest($3::text[]) AS oid
      `,
      [sample_merchant, new Date(nextDayInstant.getTime() - 3600 * 1000), stressIds]
    );

    let stopChurn = false;
    const churnWorker = (async () => {
      let step = 0;
      while (!stopChurn) {
        step += 1;
        const nextStatus = step % 2 === 0 ? "PAID" : "EXPIRED";
        await pool.query(
          `UPDATE public.payment_requests SET status = $1, updated_at = NOW() WHERE order_id = ANY($2::text[])`,
          [nextStatus, stressIds]
        );
        await new Promise((r) => setTimeout(r, 10));
      }
    })();

    try {
      results.gateway.push(
        await benchQuery(pool, "Q5_Gateway_1d_Under_PENDING_Update_Stress", gwPreAggSql, [winStart(1), nextDayInstant])
      );
      results.gateway.push(
        await benchQuery(pool, "Q5_Gateway_7d_Under_PENDING_Update_Stress", gwPreAggSql, [winStart(7), nextDayInstant])
      );
      results.gateway.push(
        await benchQuery(pool, "Q5_Gateway_30d_Under_PENDING_Update_Stress", gwPreAggSql, [winStart(30), nextDayInstant])
      );
      results.gateway.push(
        await benchQuery(pool, "Q5_Gateway_1y_Under_PENDING_Update_Stress", gwPreAggSql, [s1y, nextDayInstant])
      );
    } finally {
      stopChurn = true;
      await churnWorker;
      await pool.query(`DELETE FROM public.payment_requests WHERE order_id = ANY($1::text[])`, [stressIds]);
    }

    // 5. Other APIs: Admin countTransactions, getTransactionTimeline, Merchant stats & product-stats
    results.otherApis = [
      await benchQuery(
        pool,
        "Admin_countTransactions_1y_dashboard_tx_hourly",
        `SELECT COALESCE(SUM(tx_count), 0)::int AS total FROM public.dashboard_tx_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
        [s1y, nextDayInstant]
      ),
      await benchQuery(
        pool,
        "Admin_getTransactionTimeline_audit_outbox",
        `SELECT id, event_type, payload, created_at FROM public.audit_outbox WHERE (payload->>'transaction_id') = $1::TEXT`,
        [sample_tx]
      ),
      await benchQuery(
        pool,
        "Merchant_Web_stats_30d",
        `SELECT COUNT(t.id)::int AS order_count, COALESCE(SUM(t.amount), 0)::bigint AS gross
         FROM public.transactions t
         WHERE t.destination_user_id = $1 AND t.transaction_type = 'PAYMENT' AND t.status = 'SUCCESS'
           AND t.created_at >= $2 AND t.created_at < $3`,
        [sample_merchant, winStart(30), nextDayInstant]
      ),
      await benchQuery(
        pool,
        "Merchant_Web_revenue_chart_30d",
        `SELECT TO_CHAR(t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS date_str,
                COALESCE(SUM(t.amount - COALESCE(t.merchant_fee, 0)), 0)::bigint AS revenue,
                COALESCE(SUM(t.amount), 0)::bigint AS gross_revenue,
                COALESCE(SUM(COALESCE(t.merchant_fee, 0)), 0)::bigint AS merchant_fee,
                COUNT(t.id)::int AS order_count
         FROM public.transactions t
         WHERE t.destination_user_id = $1
           AND t.transaction_type = 'PAYMENT'
           AND t.status = 'SUCCESS'
           AND ($2::boolean = false OR t.created_at >= (($3::text)::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
           AND ($4::boolean = false OR t.created_at < ((($5::text)::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
         GROUP BY date_str
         ORDER BY date_str ASC`,
        [sample_merchant, true, toVnDate(winStart(30)), true, anchorDayStr]
      ),
      await benchQuery(
        pool,
        "Merchant_Web_product_stats",
        `SELECT pri.product_id, MAX(pri.name) AS name, COALESCE(SUM(pri.quantity),0)::bigint AS qty
         FROM public.payment_request_items pri
         JOIN public.payment_requests pr ON pri.payment_request_id = pr.id
         WHERE pr.destination_user_id = $1 AND pr.status = 'SUCCESS' AND pr.paid_at IS NOT NULL
         GROUP BY pri.product_id ORDER BY qty DESC LIMIT 20`,
        [sample_merchant]
      ),
    ];

    // Evaluate Pass/Fail Thresholds (matching Design section 4 table completely)
    const byLbl = (arr, lbl) => arr.find((r) => r.label === lbl);
    const q7_1d = byLbl(results.reports, "Q7_Full_Report_1d_day_v2");
    const q7_7d = byLbl(results.reports, "Q7_Full_Report_7d_day_v2");
    const q7_30d = byLbl(results.reports, "Q7_Full_Report_30d_day_v2");
    const q7_90d = byLbl(results.reports, "Q7_Full_Report_90d_week_v2");
    const q7_1y = byLbl(results.reports, "Q7_Full_Report_1y_month_v2");
    const expQ_v1 = byLbl(results.export, "Export_Group_quarter_v1_fee_hourly");
    const expQ_v2 = byLbl(results.export, "Export_Group_quarter_v2_merged_daily");
    const expY_v1 = byLbl(results.export, "Export_Group_year_v1_fee_hourly");
    const expY_v2 = byLbl(results.export, "Export_Group_year_v2_merged_daily");
    const expFull1y = byLbl(results.export, "Export_Full_9Sheets_SQL_1y_month_v2");
    const gw1dStress = byLbl(results.gateway, "Q5_Gateway_1d_Under_PENDING_Update_Stress");
    const gw7dStress = byLbl(results.gateway, "Q5_Gateway_7d_Under_PENDING_Update_Stress");
    const gw30dStress = byLbl(results.gateway, "Q5_Gateway_30d_Under_PENDING_Update_Stress");
    const gw1yStress = byLbl(results.gateway, "Q5_Gateway_1y_Under_PENDING_Update_Stress");
    const dashShortMaxP50 = Math.max(...results.dashboard.filter((r) => !r.label.includes("1y")).map((r) => r.p50Ms));
    const dashShortMaxP95 = Math.max(...results.dashboard.filter((r) => !r.label.includes("1y")).map((r) => r.p95Ms));
    const dash1yMaxP50 = Math.max(...results.dashboard.filter((r) => r.label.includes("1y")).map((r) => r.p50Ms));
    const dash1yMaxP95 = Math.max(...results.dashboard.filter((r) => r.label.includes("1y")).map((r) => r.p95Ms));
    const repShortMaxP95 = Math.max(...results.reports.filter((r) => /^(Q3_Q4_KPI|Q_MerchantsPage)_(1d|30d)/.test(r.label)).map((r) => r.p95Ms));
    const rep1yKpi = byLbl(results.reports, "Q3_Q4_KPI_1y_month_v2");
    const rep1yMerch = byLbl(results.reports, "Q_MerchantsPage_1y_month_v2");

    const checks = [
      { name: "Q7_1y_month_P50<=1500ms", pass: q7_1y.p50Ms <= 1500, actual: q7_1y.p50Ms },
      { name: "Q7_1y_month_P95<=2200ms", pass: q7_1y.p95Ms <= 2200, actual: q7_1y.p95Ms },
      { name: "Q7_1y_month_tmp<5000_blks", pass: q7_1y.tempWrittenBlocks < 5000, actual: q7_1y.tempWrittenBlocks },
      { name: "Q7_1d_7d_30d_90d_P95<=60/150/450/1000", pass: q7_1d.p95Ms <= 60 && q7_7d.p95Ms <= 150 && q7_30d.p95Ms <= 450 && q7_90d.p95Ms <= 1000, actual: { p95_1d: q7_1d.p95Ms, p95_7d: q7_7d.p95Ms, p95_30d: q7_30d.p95Ms, p95_90d: q7_90d.p95Ms } },
      { name: "Export_quarter_P50<=280&_P95<=360_&_+20%/+25%_v1", pass: expQ_v2.p50Ms <= 280 && expQ_v2.p50Ms <= expQ_v1.p50Ms * 1.2 && expQ_v2.p95Ms <= 360 && expQ_v2.p95Ms <= expQ_v1.p95Ms * 1.25, actual: { p50_v2: expQ_v2.p50Ms, p50_v1: expQ_v1.p50Ms, p95_v2: expQ_v2.p95Ms, p95_v1: expQ_v1.p95Ms } },
      { name: "Export_year_P50<=280&_P95<=360_&_+20%/+25%_v1", pass: expY_v2.p50Ms <= 280 && expY_v2.p50Ms <= expY_v1.p50Ms * 1.2 && expY_v2.p95Ms <= 360 && expY_v2.p95Ms <= expY_v1.p95Ms * 1.25, actual: { p50_v2: expY_v2.p50Ms, p50_v1: expY_v1.p50Ms, p95_v2: expY_v2.p95Ms, p95_v1: expY_v1.p95Ms } },
      { name: "Export_Full_9Sheets_SQL_1y_P50<=3000ms", pass: expFull1y.p50Ms <= 3000, actual: expFull1y.p50Ms },
      { name: "Dashboard_1d..90d<=25/50_&_1y<=80/120ms", pass: dashShortMaxP50 <= 25 && dashShortMaxP95 <= 50 && dash1yMaxP50 <= 80 && dash1yMaxP95 <= 120, actual: { shortP50: dashShortMaxP50, shortP95: dashShortMaxP95, y1P50: dash1yMaxP50, y1P95: dash1yMaxP95 } },
      { name: "Report_KPI_Merchants_1d..30d_P95<=90_&_1y<=200/320", pass: repShortMaxP95 <= 90 && rep1yKpi.p50Ms <= 200 && rep1yKpi.p95Ms <= 320 && rep1yMerch.p50Ms <= 200 && rep1yMerch.p95Ms <= 320, actual: { shortP95: repShortMaxP95, kpi1y: [rep1yKpi.p50Ms, rep1yKpi.p95Ms], merch1y: [rep1yMerch.p50Ms, rep1yMerch.p95Ms] } },
      { name: "Gateway_Stress_1d<=10_7d<=20_30d<=100_1y<=150/250ms", pass: gw1dStress.p95Ms <= 10 && gw7dStress.p95Ms <= 20 && gw30dStress.p95Ms <= 100 && gw1yStress.p50Ms <= 150 && gw1yStress.p95Ms <= 250, actual: { p95_1d: gw1dStress.p95Ms, p95_7d: gw7dStress.p95Ms, p95_30d: gw30dStress.p95Ms, p50_1y: gw1yStress.p50Ms, p95_1y: gw1yStress.p95Ms } },
    ];

    const outPath = process.env.BENCH_OUT || DEFAULT_OUT;
    fs.writeFileSync(outPath, JSON.stringify({ db, checks, results }, null, 2));

    console.log("\n=== BENCHMARK RESULTS (DASHBOARD) ===");
    console.table(results.dashboard.map((r) => ({ label: r.label, p50: r.p50Ms, p95: r.p95Ms, cold: r.coldMs, tmp: r.tempWrittenBlocks })));
    console.log("\n=== BENCHMARK RESULTS (REPORTS) ===");
    console.table(results.reports.map((r) => ({ label: r.label, p50: r.p50Ms, p95: r.p95Ms, cold: r.coldMs, tmp: r.tempWrittenBlocks })));
    console.log("\n=== BENCHMARK RESULTS (EXPORT 5 GRANULARITIES & FULL WORKBOOK) ===");
    console.table(results.export.map((r) => ({ label: r.label, p50: r.p50Ms, p95: r.p95Ms, cold: r.coldMs })));
    console.log("\n=== BENCHMARK RESULTS (GATEWAY + PENDING STRESS) ===");
    console.table(results.gateway.map((r) => ({ label: r.label, p50: r.p50Ms, p95: r.p95Ms, heapFetches: r.heapFetches })));
    console.log("\n=== BENCHMARK RESULTS (OTHER APIS) ===");
    console.table(results.otherApis.map((r) => ({ label: r.label, p50: r.p50Ms, p95: r.p95Ms, nodes: r.topNodes.join(" -> ") })));
    console.log("\n=== GATE 4 THRESHOLD CHECKS ===");
    console.table(checks);

    if (checks.some((c) => !c.pass)) {
      throw new Error("One or more Gate 4 benchmark thresholds failed!");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
