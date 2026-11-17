const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = require("../src/config/database");
const { resolveAdminDateRange } = require("../src/utils/dateRange");
const { REPORT_SQL } = require("../src/admin/reports/reports.service");

const REPORT_ROLLUP_LOCK_KEY = 2026111602;
const CHUNK_DAYS = 14;

async function main() {
  const client = await pool.connect();
  try {
    const boundsRes = await client.query(`
      SELECT
        (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS cutoff,
        LEAST(
          (SELECT MIN(date_trunc('hour', created_at)) FROM public.fee_ledger_entries),
          (SELECT MIN(date_trunc('hour', created_at)) FROM public.transactions WHERE transaction_type IN ('PAYMENT', 'TRANSFER')),
          (SELECT MIN(date_trunc('hour', created_at)) FROM public.payment_requests WHERE created_at IS NOT NULL)
        ) AS min_hour
    `);

    const cutoff = boundsRes.rows[0].cutoff;
    const minHour = boundsRes.rows[0].min_hour;
    console.log("Target report rollup_until (00:00 Asia/Ho_Chi_Minh):", cutoff.toISOString());
    console.log("Earliest source hour:", minHour ? minHour.toISOString() : "none");

    const startMs = Date.now();

    // Reset state cleanly under advisory lock before chunked backfill
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [REPORT_ROLLUP_LOCK_KEY]);
    await client.query(`
      TRUNCATE TABLE
        public.report_merchant_fee_hourly,
        public.report_merchant_tx_hourly,
        public.report_gateway_hourly,
        public.report_dirty_hours
    `);
    await client.query(`
      INSERT INTO public.report_rollup_state (id, rollup_until, updated_at)
      VALUES (1, '-infinity'::timestamptz, NOW())
      ON CONFLICT (id) DO UPDATE SET rollup_until = '-infinity'::timestamptz, updated_at = NOW()
    `);
    await client.query("COMMIT");

    let totalFeeRows = 0;
    let totalTxRows = 0;
    let totalGwRows = 0;

    if (minHour && new Date(minHour).getTime() < new Date(cutoff).getTime()) {
      let chunkStart = new Date(minHour);
      let chunkIdx = 0;

      while (chunkStart.getTime() < new Date(cutoff).getTime()) {
        const nextMs = Math.min(
          chunkStart.getTime() + CHUNK_DAYS * 24 * 60 * 60 * 1000,
          new Date(cutoff).getTime(),
        );
        const chunkEnd = new Date(nextMs);
        chunkIdx += 1;

        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [REPORT_ROLLUP_LOCK_KEY]);
        await client.query("SET LOCAL work_mem = '128MB'");

        const feeRes = await client.query(
          `
          INSERT INTO public.report_merchant_fee_hourly (
            bucket_hour, merchant_id, transaction_type, fee_amount, fee_tx_count, updated_at
          )
          SELECT
            date_trunc('hour', l.created_at) AS bucket_hour,
            u.id AS merchant_id,
            t.transaction_type::text AS transaction_type,
            COALESCE(SUM(l.amount), 0)::numeric(22, 0) AS fee_amount,
            COUNT(*)::bigint AS fee_tx_count,
            NOW() AS updated_at
          FROM public.fee_ledger_entries l
          JOIN public.transactions t ON t.id = l.transaction_id
          JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
          WHERE l.fee_type = 'QR_FEE'
            AND t.status IN ('SUCCESS', 'COMPLETED')
            AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
            AND l.created_at >= $1
            AND l.created_at < $2
          GROUP BY 1, 2, 3
          ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
            fee_amount = EXCLUDED.fee_amount,
            fee_tx_count = EXCLUDED.fee_tx_count,
            updated_at = NOW()
          `,
          [chunkStart, chunkEnd],
        );

        const txRes = await client.query(
          `
          INSERT INTO public.report_merchant_tx_hourly (
            bucket_hour, merchant_id, transaction_type, tx_count, tx_amount, merchant_fee_total, updated_at
          )
          SELECT
            date_trunc('hour', t.created_at) AS bucket_hour,
            u.id AS merchant_id,
            t.transaction_type::text AS transaction_type,
            COUNT(*)::bigint AS tx_count,
            COALESCE(SUM(t.amount), 0)::numeric(22, 0) AS tx_amount,
            COALESCE(SUM(COALESCE(t.merchant_fee, 0)), 0)::numeric(22, 0) AS merchant_fee_total,
            NOW() AS updated_at
          FROM public.transactions t
          JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
          WHERE t.status IN ('SUCCESS', 'COMPLETED')
            AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
            AND t.created_at >= $1
            AND t.created_at < $2
          GROUP BY 1, 2, 3
          ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
            tx_count = EXCLUDED.tx_count,
            tx_amount = EXCLUDED.tx_amount,
            merchant_fee_total = EXCLUDED.merchant_fee_total,
            updated_at = NOW()
          `,
          [chunkStart, chunkEnd],
        );

        const gwRes = await client.query(
          `
          INSERT INTO public.report_gateway_hourly (
            bucket_hour, merchant_id, has_order_id,
            total_requests, success_count, pending_count, expired_count, failed_count, cancelled_count, updated_at
          )
          SELECT
            date_trunc('hour', pr.created_at) AS bucket_hour,
            u.id AS merchant_id,
            (pr.order_id IS NOT NULL) AS has_order_id,
            COUNT(*)::bigint AS total_requests,
            COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS', 'PAID'))::bigint AS success_count,
            COUNT(*) FILTER (WHERE pr.status = 'PENDING')::bigint AS pending_count,
            COUNT(*) FILTER (WHERE pr.status = 'EXPIRED')::bigint AS expired_count,
            COUNT(*) FILTER (WHERE pr.status = 'FAILED')::bigint AS failed_count,
            COUNT(*) FILTER (WHERE pr.status = 'CANCELLED')::bigint AS cancelled_count,
            NOW() AS updated_at
          FROM public.payment_requests pr
          JOIN public.users u ON u.id = pr.destination_user_id AND u.role = 'MERCHANT'
          WHERE pr.created_at IS NOT NULL
            AND pr.created_at >= $1
            AND pr.created_at < $2
          GROUP BY 1, 2, 3
          ON CONFLICT (bucket_hour, merchant_id, has_order_id) DO UPDATE SET
            total_requests = EXCLUDED.total_requests,
            success_count = EXCLUDED.success_count,
            pending_count = EXCLUDED.pending_count,
            expired_count = EXCLUDED.expired_count,
            failed_count = EXCLUDED.failed_count,
            cancelled_count = EXCLUDED.cancelled_count,
            updated_at = NOW()
          `,
          [chunkStart, chunkEnd],
        );

        await client.query(
          `DELETE FROM public.report_dirty_hours WHERE bucket_hour >= $1 AND bucket_hour < $2`,
          [chunkStart, chunkEnd],
        );

        await client.query(
          `UPDATE public.report_rollup_state SET rollup_until = $1, updated_at = NOW() WHERE id = 1`,
          [chunkEnd],
        );

        await client.query("COMMIT");
        totalFeeRows += feeRes.rowCount || 0;
        totalTxRows += txRes.rowCount || 0;
        totalGwRows += gwRes.rowCount || 0;

        console.log(
          `Chunk ${chunkIdx} [${chunkStart.toISOString()} .. ${chunkEnd.toISOString()}): ` +
            `fee=${feeRes.rowCount}, tx=${txRes.rowCount}, gw=${gwRes.rowCount}`,
        );
        chunkStart = chunkEnd;
      }
    } else {
      await client.query("BEGIN");
      await client.query(
        `UPDATE public.report_rollup_state SET rollup_until = $1, updated_at = NOW() WHERE id = 1`,
        [cutoff],
      );
      await client.query("COMMIT");
    }

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(2);
    console.log(
      `Backfill committed in ${elapsedSec}s: feeRows=${totalFeeRows}, txRows=${totalTxRows}, gwRows=${totalGwRows}`,
    );

    // Parity verification 1: Full cutoff rollup tables vs raw source tables
    const feeParity = await pool.query(
      `
      SELECT
        COALESCE(raw.type, r.transaction_type) AS type,
        COALESCE(raw.fee_amount, 0)::numeric(22,0)::text AS raw_fee,
        COALESCE(r.fee_amount, 0)::numeric(22,0)::text AS rollup_fee,
        COALESCE(raw.cnt, 0)::bigint::text AS raw_cnt,
        COALESCE(r.cnt, 0)::bigint::text AS rollup_cnt
      FROM (
        SELECT t.transaction_type::text AS type, SUM(l.amount) AS fee_amount, COUNT(*) AS cnt
        FROM public.fee_ledger_entries l
        JOIN public.transactions t ON t.id = l.transaction_id
        JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
        WHERE l.fee_type = 'QR_FEE'
          AND t.status IN ('SUCCESS', 'COMPLETED')
          AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
          AND l.created_at < $1
        GROUP BY 1
      ) raw
      FULL OUTER JOIN (
        SELECT transaction_type, SUM(fee_amount) AS fee_amount, SUM(fee_tx_count) AS cnt
        FROM public.report_merchant_fee_hourly
        WHERE bucket_hour < $1
        GROUP BY 1
      ) r ON raw.type = r.transaction_type
      ORDER BY 1
      `,
      [cutoff],
    );
    console.log("Fee parity check:");
    console.table(feeParity.rows);
    for (const r of feeParity.rows) {
      if (r.raw_fee !== r.rollup_fee || r.raw_cnt !== r.rollup_cnt) {
        throw new Error(`Fee parity mismatch: ${JSON.stringify(r)}`);
      }
    }

    const txParity = await pool.query(
      `
      SELECT
        COALESCE(raw.type, r.transaction_type) AS type,
        COALESCE(raw.cnt, 0)::bigint::text AS raw_cnt,
        COALESCE(r.cnt, 0)::bigint::text AS rollup_cnt,
        COALESCE(raw.amt, 0)::numeric(22,0)::text AS raw_amt,
        COALESCE(r.amt, 0)::numeric(22,0)::text AS rollup_amt,
        COALESCE(raw.mfee, 0)::numeric(22,0)::text AS raw_mfee,
        COALESCE(r.mfee, 0)::numeric(22,0)::text AS rollup_mfee
      FROM (
        SELECT t.transaction_type::text AS type, COUNT(*) AS cnt, SUM(t.amount) AS amt, SUM(COALESCE(t.merchant_fee, 0)) AS mfee
        FROM public.transactions t
        JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
        WHERE t.status IN ('SUCCESS', 'COMPLETED')
          AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
          AND t.created_at < $1
        GROUP BY 1
      ) raw
      FULL OUTER JOIN (
        SELECT transaction_type, SUM(tx_count) AS cnt, SUM(tx_amount) AS amt, SUM(merchant_fee_total) AS mfee
        FROM public.report_merchant_tx_hourly
        WHERE bucket_hour < $1
        GROUP BY 1
      ) r ON raw.type = r.transaction_type
      ORDER BY 1
      `,
      [cutoff],
    );
    console.log("Merchant TX parity check:");
    console.table(txParity.rows);
    for (const r of txParity.rows) {
      if (r.raw_cnt !== r.rollup_cnt || r.raw_amt !== r.rollup_amt || r.raw_mfee !== r.rollup_mfee) {
        throw new Error(`TX parity mismatch: ${JSON.stringify(r)}`);
      }
    }

    const gwParity = await pool.query(
      `
      SELECT
        COALESCE(raw.has_order_id, r.has_order_id) AS has_order_id,
        COALESCE(raw.total, 0)::bigint::text AS raw_total,
        COALESCE(r.total, 0)::bigint::text AS rollup_total,
        COALESCE(raw.success, 0)::bigint::text AS raw_success,
        COALESCE(r.success, 0)::bigint::text AS rollup_success,
        COALESCE(raw.pending, 0)::bigint::text AS raw_pending,
        COALESCE(r.pending, 0)::bigint::text AS rollup_pending,
        COALESCE(raw.expired, 0)::bigint::text AS raw_expired,
        COALESCE(r.expired, 0)::bigint::text AS rollup_expired,
        COALESCE(raw.failed, 0)::bigint::text AS raw_failed,
        COALESCE(r.failed, 0)::bigint::text AS rollup_failed,
        COALESCE(raw.cancelled, 0)::bigint::text AS raw_cancelled,
        COALESCE(r.cancelled, 0)::bigint::text AS rollup_cancelled
      FROM (
        SELECT
          (pr.order_id IS NOT NULL) AS has_order_id,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS', 'PAID')) AS success,
          COUNT(*) FILTER (WHERE pr.status = 'PENDING') AS pending,
          COUNT(*) FILTER (WHERE pr.status = 'EXPIRED') AS expired,
          COUNT(*) FILTER (WHERE pr.status = 'FAILED') AS failed,
          COUNT(*) FILTER (WHERE pr.status = 'CANCELLED') AS cancelled
        FROM public.payment_requests pr
        JOIN public.users u ON u.id = pr.destination_user_id AND u.role = 'MERCHANT'
        WHERE pr.created_at IS NOT NULL AND pr.created_at < $1
        GROUP BY 1
      ) raw
      FULL OUTER JOIN (
        SELECT
          has_order_id,
          SUM(total_requests) AS total,
          SUM(success_count) AS success,
          SUM(pending_count) AS pending,
          SUM(expired_count) AS expired,
          SUM(failed_count) AS failed,
          SUM(cancelled_count) AS cancelled
        FROM public.report_gateway_hourly
        WHERE bucket_hour < $1
        GROUP BY 1
      ) r ON raw.has_order_id = r.has_order_id
      ORDER BY 1
      `,
      [cutoff],
    );
    console.log("Gateway parity check:");
    console.table(gwParity.rows);
    for (const r of gwParity.rows) {
      for (const col of ["total", "success", "pending", "expired", "failed", "cancelled"]) {
        if (r[`raw_${col}`] !== r[`rollup_${col}`]) {
          throw new Error(`Gateway parity mismatch on ${col}: ${JSON.stringify(r)}`);
        }
      }
    }

    // Parity verification 2: End-to-end Hybrid windows (Hôm nay, Tháng này, Năm nay) vs REPORT_SQL
    const defaultRange = resolveAdminDateRange(); // month
    const todayStr = defaultRange.endDate;
    const windows = [
      { label: "Hôm nay", range: resolveAdminDateRange(todayStr, todayStr), group: "day" },
      { label: "Tháng này", range: defaultRange, group: "day" },
      { label: "Năm nay", range: resolveAdminDateRange(`${todayStr.slice(0, 4)}-01-01`, todayStr), group: "month" },
    ];

    for (const w of windows) {
      const s = w.range.startInstant;
      const e = w.range.nextDayInstant;
      const splitMs = Math.min(Math.max(cutoff.getTime(), s.getTime()), e.getTime());
      const split = new Date(splitMs);

      const rawData = (
        await pool.query(REPORT_SQL, [s, e, null, null, w.group, 20, 0])
      ).rows[0].data;

      const hybridOverview = (
        await pool.query(
          `
          WITH f AS (
            SELECT COALESCE(SUM(fee_amount), 0) AS rev FROM public.report_merchant_fee_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2
            UNION ALL
            SELECT COALESCE(SUM(l.amount), 0) AS rev
            FROM public.fee_ledger_entries l
            JOIN public.transactions t ON t.id = l.transaction_id
            JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
            WHERE l.fee_type = 'QR_FEE' AND t.status IN ('SUCCESS', 'COMPLETED')
              AND t.transaction_type IN ('PAYMENT', 'TRANSFER') AND l.created_at >= $2 AND l.created_at < $3
          ), tx AS (
            SELECT COALESCE(SUM(tx_amount), 0) AS gross, COALESCE(SUM(tx_count), 0) AS cnt
            FROM public.report_merchant_tx_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2
            UNION ALL
            SELECT COALESCE(SUM(t.amount), 0) AS gross, COUNT(*) AS cnt
            FROM public.transactions t
            JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
            WHERE t.status IN ('SUCCESS', 'COMPLETED')
              AND t.transaction_type IN ('PAYMENT', 'TRANSFER') AND t.created_at >= $2 AND t.created_at < $3
          ), gw AS (
            SELECT COALESCE(SUM(total_requests), 0) AS total, COALESCE(SUM(success_count), 0) AS success,
              COALESCE(SUM(pending_count), 0) AS pending, COALESCE(SUM(expired_count), 0) AS expired,
              COALESCE(SUM(failed_count), 0) AS failed, COALESCE(SUM(cancelled_count), 0) AS cancelled
            FROM public.report_gateway_hourly WHERE has_order_id = true AND bucket_hour >= $1 AND bucket_hour < $2
            UNION ALL
            SELECT COUNT(*), COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS','PAID')),
              COUNT(*) FILTER (WHERE pr.status = 'PENDING'), COUNT(*) FILTER (WHERE pr.status = 'EXPIRED'),
              COUNT(*) FILTER (WHERE pr.status = 'FAILED'), COUNT(*) FILTER (WHERE pr.status = 'CANCELLED')
            FROM public.payment_requests pr
            JOIN public.users u ON u.id = pr.destination_user_id AND u.role = 'MERCHANT'
            WHERE pr.order_id IS NOT NULL AND pr.created_at >= $2 AND pr.created_at < $3
          )
          SELECT
            (SELECT COALESCE(SUM(rev), 0)::bigint FROM f) AS revenue,
            (SELECT COALESCE(SUM(gross), 0)::bigint FROM tx) AS gross,
            (SELECT COALESCE(SUM(cnt), 0)::bigint FROM tx) AS transactions,
            (SELECT COALESCE(SUM(total), 0)::bigint FROM gw) AS gw_total,
            (SELECT COALESCE(SUM(success), 0)::bigint FROM gw) AS gw_success,
            (SELECT COALESCE(SUM(pending), 0)::bigint FROM gw) AS gw_pending,
            (SELECT COALESCE(SUM(expired), 0)::bigint FROM gw) AS gw_expired,
            (SELECT COALESCE(SUM(failed), 0)::bigint FROM gw) AS gw_failed,
            (SELECT COALESCE(SUM(cancelled), 0)::bigint FROM gw) AS gw_cancelled
          `,
          [s, split, e],
        )
      ).rows[0];

      const cmp = {
        revenue: [Number(rawData.overview.revenue), Number(hybridOverview.revenue)],
        gross: [Number(rawData.overview.gross), Number(hybridOverview.gross)],
        transactions: [Number(rawData.overview.transactions), Number(hybridOverview.transactions)],
        gw_total: [Number(rawData.gateway.total), Number(hybridOverview.gw_total)],
        gw_success: [Number(rawData.gateway.success), Number(hybridOverview.gw_success)],
        gw_pending: [Number(rawData.gateway.pending), Number(hybridOverview.gw_pending)],
        gw_expired: [Number(rawData.gateway.expired), Number(hybridOverview.gw_expired)],
        gw_failed: [Number(rawData.gateway.failed), Number(hybridOverview.gw_failed)],
        gw_cancelled: [Number(rawData.gateway.cancelled), Number(hybridOverview.gw_cancelled)],
      };
      console.log(`Window [${w.label}] parity:`, cmp);
      for (const [k, [rv, hv]] of Object.entries(cmp)) {
        if (rv !== hv) {
          throw new Error(`Window [${w.label}] parity mismatch on ${k}: raw=${rv}, hybrid=${hv}`);
        }
      }
    }

    console.log("ALL Report Hybrid Rollup Backfill & Parity checks PASSED (0 discrepancy)!");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Report backfill failed:", err);
  process.exit(1);
});
