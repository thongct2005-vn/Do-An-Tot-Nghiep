const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const defaultPool = require("../src/config/database");

const DASHBOARD_ROLLUP_LOCK_KEY = 2026111601;
const REPORT_ROLLUP_LOCK_KEY = 2026111602;
const CHUNK_DAYS = 14;

async function computeDashboardTargetCutoff(db) {
  const res = await db.query(
    `SELECT date_trunc('hour', NOW() - INTERVAL '1 hour') AS cutoff`
  );
  return new Date(res.rows[0].cutoff);
}

async function computeReportTargetCutoff(db) {
  const res = await db.query(`
    SELECT (
      DATE_TRUNC('day', (NOW() - INTERVAL '1 minute') AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
    ) AS cutoff
  `);
  return new Date(res.rows[0].cutoff);
}

async function waitForXidDrain(db, guardCommittedAt, maxWaitMs = 10000) {
  if (!guardCommittedAt) return { drained: true, waitedMs: 0 };
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const res = await db.query(
      `
      SELECT COUNT(*)::int AS active_pre_guard
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND backend_type = 'client backend'
        AND xact_start IS NOT NULL
        AND xact_start <= $1::timestamptz
        AND (backend_xid IS NOT NULL OR state <> 'idle')
      `,
      [guardCommittedAt]
    );
    if ((res.rows[0]?.active_pre_guard || 0) === 0) {
      return { drained: true, waitedMs: Date.now() - started };
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return { drained: false, waitedMs: Date.now() - started };
}

async function reconcileReportDays(client, days, cutoff) {
  if (!Array.isArray(days) || days.length === 0) return;

  const sorted = [...new Set(days.map((d) => new Date(d).toISOString()))]
    .sort()
    .map((iso) => new Date(iso));

  // Derive distinct VN dates (YYYY-MM-DD text) ordered ASC for deterministic lock order
  const txDaysRes = await client.query(
    `
    SELECT ARRAY(
      SELECT DISTINCT ((ts AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::text
      FROM unnest($1::timestamptz[]) AS ts
      ORDER BY 1 ASC
    ) AS vn_days
    `,
    [sorted]
  );
  const vnDays = txDaysRes.rows[0]?.vn_days || [];
  if (vnDays.length === 0) return;

  // Independent TX branch update (never wipes fee_amount / fee_tx_count)
  await client.query(
    `
    UPDATE public.report_merchant_financial_daily
    SET tx_count = 0, tx_amount = 0, updated_at = NOW()
    WHERE bucket_day = ANY($1::date[])
    `,
    [vnDays]
  );
  await client.query(
    `
    INSERT INTO public.report_merchant_financial_daily (
      bucket_day, merchant_id, transaction_type, tx_count, tx_amount, updated_at
    )
    SELECT
      (t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_day,
      u.id AS merchant_id,
      t.transaction_type::text AS transaction_type,
      COUNT(*)::bigint AS tx_count,
      COALESCE(SUM(t.amount), 0)::numeric(22, 0) AS tx_amount,
      NOW() AS updated_at
    FROM unnest($1::date[]) AS d(bucket_day)
    JOIN public.transactions t
      ON t.created_at >= (d.bucket_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
     AND t.created_at < ((d.bucket_day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
    JOIN public.users u
      ON u.id = t.destination_user_id
     AND u.role = 'MERCHANT'
    WHERE t.created_at < $2
      AND t.status IN ('SUCCESS', 'COMPLETED')
      AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
      AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
    GROUP BY 1, 2, 3
    ON CONFLICT (bucket_day, merchant_id, transaction_type) DO UPDATE SET
      tx_count   = EXCLUDED.tx_count,
      tx_amount  = EXCLUDED.tx_amount,
      updated_at = NOW()
    `,
    [vnDays, cutoff]
  );

  // Independent Fee branch update (never wipes tx_count / tx_amount)
  await client.query(
    `
    UPDATE public.report_merchant_financial_daily
    SET fee_amount = 0, fee_tx_count = 0, updated_at = NOW()
    WHERE bucket_day = ANY($1::date[])
    `,
    [vnDays]
  );
  await client.query(
    `
    INSERT INTO public.report_merchant_financial_daily (
      bucket_day, merchant_id, transaction_type, fee_amount, fee_tx_count, updated_at
    )
    SELECT
      (l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_day,
      u.id AS merchant_id,
      t.transaction_type::text AS transaction_type,
      COALESCE(SUM(l.amount), 0)::numeric(22, 0) AS fee_amount,
      COUNT(*)::bigint AS fee_tx_count,
      NOW() AS updated_at
    FROM unnest($1::date[]) AS d(bucket_day)
    JOIN public.fee_ledger_entries l
      ON l.created_at >= (d.bucket_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
     AND l.created_at < ((d.bucket_day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
    JOIN public.transactions t
      ON t.id = l.transaction_id
    JOIN public.users u
      ON u.id = t.destination_user_id
     AND u.role = 'MERCHANT'
    WHERE l.created_at < $2
      AND l.fee_type = 'QR_FEE'
      AND l.transaction_id IS NOT NULL
      AND t.status IN ('SUCCESS', 'COMPLETED')
      AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
      AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
    GROUP BY 1, 2, 3
    ON CONFLICT (bucket_day, merchant_id, transaction_type) DO UPDATE SET
      fee_amount   = EXCLUDED.fee_amount,
      fee_tx_count = EXCLUDED.fee_tx_count,
      updated_at   = NOW()
    `,
    [vnDays, cutoff]
  );

  // Clean rows where BOTH TX and Fee became 0
  await client.query(
    `
    DELETE FROM public.report_merchant_financial_daily
    WHERE bucket_day = ANY($1::date[])
      AND tx_count = 0
      AND tx_amount = 0
      AND fee_amount = 0
      AND fee_tx_count = 0
    `,
    [vnDays]
  );
}

async function runAnalyticsV2Backfill(db = defaultPool, options = {}) {
  const dashCutoff = options.dashCutoff
    ? new Date(options.dashCutoff)
    : await computeDashboardTargetCutoff(db);
  const reportCutoff = options.reportCutoff
    ? new Date(options.reportCutoff)
    : await computeReportTargetCutoff(db);

  const client = await db.connect();
  try {
    const boundsRes = await client.query(`
      SELECT LEAST(
        (SELECT MIN(created_at) FROM public.fee_ledger_entries WHERE fee_type = 'QR_FEE'),
        (SELECT MIN(created_at) FROM public.transactions WHERE transaction_type IN ('PAYMENT', 'TRANSFER'))
      ) AS min_report_ts,
      (SELECT MIN(created_at) FROM public.transactions) AS min_dash_ts
    `);

    const minReportTs = boundsRes.rows[0].min_report_ts
      ? new Date(boundsRes.rows[0].min_report_ts)
      : null;

    if (!options.silent) {
      console.log("Dashboard target cutoff (UTC rounded hour):", dashCutoff.toISOString());
      console.log("Report target cutoff (00:00:00+07:00 VN):", reportCutoff.toISOString());
    }

    const startedMs = Date.now();

    // Step 1: Reset state cleanly (avoid ACCESS EXCLUSIVE TRUNCATE locks) & arm dirty_guard_until while keeping rollup_until = -infinity
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [DASHBOARD_ROLLUP_LOCK_KEY]);
    await client.query("SELECT pg_advisory_xact_lock($1)", [REPORT_ROLLUP_LOCK_KEY]);
    await client.query("DELETE FROM public.report_merchant_financial_daily");
    await client.query("DELETE FROM public.aggregation_dirty_buckets");
    if (!options.preserveDashboardHourly) {
      await client.query("DELETE FROM public.dashboard_tx_hourly");
    }
    await client.query(
      `
      INSERT INTO public.aggregation_rollup_state (domain, rollup_until, dirty_guard_until, updated_at)
      VALUES
        ('dashboard', '-infinity'::timestamptz, $1, NOW()),
        ('report_merchant', '-infinity'::timestamptz, $2, NOW())
      ON CONFLICT (domain) DO UPDATE SET
        rollup_until = '-infinity'::timestamptz,
        dirty_guard_until = EXCLUDED.dirty_guard_until,
        updated_at = NOW()
      `,
      [dashCutoff, reportCutoff]
    );
    await client.query("COMMIT");
    const tsAfterRes = await db.query(`SELECT clock_timestamp() AS guard_committed_at`);
    const drainInfo = await waitForXidDrain(
      db,
      tsAfterRes.rows[0]?.guard_committed_at,
      options.maxXidWaitMs ?? 10000
    );
    if (!drainInfo.drained) {
      throw new Error(
        `Timed out waiting ${drainInfo.waitedMs}ms for pre-guard XIDs to drain before backfill`
      );
    }

    if (typeof options.onAfterGuardBarrier === "function") {
      await options.onAfterGuardBarrier({ dashCutoff, reportCutoff });
    }

    // Step 2: Backfill dashboard_tx_hourly (UTC hourly)
    if (!options.preserveDashboardHourly) {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [DASHBOARD_ROLLUP_LOCK_KEY]);
      await client.query("SET LOCAL work_mem = '128MB'");
      await client.query(
        `
        INSERT INTO public.dashboard_tx_hourly (
          bucket_hour, transaction_type, status, tx_count, total_amount, updated_at
        )
        SELECT
          date_trunc('hour', created_at) AS bucket_hour,
          transaction_type::text AS transaction_type,
          status::text AS status,
          COUNT(*)::bigint AS tx_count,
          COALESCE(SUM(amount), 0)::numeric(22, 0) AS total_amount,
          NOW() AS updated_at
        FROM public.transactions
        WHERE created_at < $1
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, transaction_type, status) DO UPDATE SET
          tx_count = EXCLUDED.tx_count,
          total_amount = EXCLUDED.total_amount,
          updated_at = NOW()
        `,
        [dashCutoff]
      );
      await client.query("COMMIT");
    } else {
      // Top up closed UTC hours between existing dashboard_tx_hourly max/current and dashCutoff if any
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [DASHBOARD_ROLLUP_LOCK_KEY]);
      await client.query("SET LOCAL work_mem = '64MB'");
      await client.query(
        `
        DELETE FROM public.dashboard_tx_hourly
        WHERE bucket_hour >= date_trunc('day', $1 AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
          AND bucket_hour < $1
        `,
        [dashCutoff]
      );
      await client.query(
        `
        INSERT INTO public.dashboard_tx_hourly (
          bucket_hour, transaction_type, status, tx_count, total_amount, updated_at
        )
        SELECT
          date_trunc('hour', created_at) AS bucket_hour,
          transaction_type::text AS transaction_type,
          status::text AS status,
          COUNT(*)::bigint AS tx_count,
          COALESCE(SUM(amount), 0)::numeric(22, 0) AS total_amount,
          NOW() AS updated_at
        FROM public.transactions
        WHERE created_at >= (date_trunc('day', $1 AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND created_at < $1
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, transaction_type, status) DO UPDATE SET
          tx_count = EXCLUDED.tx_count,
          total_amount = EXCLUDED.total_amount,
          updated_at = NOW()
        `,
        [dashCutoff]
      );
      await client.query("COMMIT");
    }

    // Step 3: Chunked backfill of report_merchant_financial_daily aligned on VN midnight chunks
    let totalTxUpserted = 0;
    let totalFeeUpserted = 0;

    if (minReportTs && minReportTs.getTime() < reportCutoff.getTime()) {
      const startDayRes = await client.query(
        `SELECT (DATE_TRUNC('day', $1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS start_vn`,
        [minReportTs]
      );
      let chunkStart = new Date(startDayRes.rows[0].start_vn);
      let chunkNo = 0;

      while (chunkStart.getTime() < reportCutoff.getTime()) {
        const chunkEnd = new Date(
          Math.min(
            chunkStart.getTime() + CHUNK_DAYS * 24 * 60 * 60 * 1000,
            reportCutoff.getTime()
          )
        );
        chunkNo += 1;

        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [REPORT_ROLLUP_LOCK_KEY]);
        await client.query("SET LOCAL work_mem = '128MB'");

        const txRes = await client.query(
          `
          INSERT INTO public.report_merchant_financial_daily (
            bucket_day, merchant_id, transaction_type, tx_count, tx_amount, updated_at
          )
          SELECT
            (t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_day,
            u.id AS merchant_id,
            t.transaction_type::text AS transaction_type,
            COUNT(*)::bigint AS tx_count,
            COALESCE(SUM(t.amount), 0)::numeric(22, 0) AS tx_amount,
            NOW() AS updated_at
          FROM public.transactions t
          JOIN public.users u
            ON u.id = t.destination_user_id
           AND u.role = 'MERCHANT'
          WHERE t.created_at >= $1
            AND t.created_at < $2
            AND t.status IN ('SUCCESS', 'COMPLETED')
            AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
            AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
          GROUP BY 1, 2, 3
          ON CONFLICT (bucket_day, merchant_id, transaction_type) DO UPDATE SET
            tx_count   = EXCLUDED.tx_count,
            tx_amount  = EXCLUDED.tx_amount,
            updated_at = NOW()
          `,
          [chunkStart, chunkEnd]
        );

        const feeRes = await client.query(
          `
          INSERT INTO public.report_merchant_financial_daily (
            bucket_day, merchant_id, transaction_type, fee_amount, fee_tx_count, updated_at
          )
          SELECT
            (l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_day,
            u.id AS merchant_id,
            t.transaction_type::text AS transaction_type,
            COALESCE(SUM(l.amount), 0)::numeric(22, 0) AS fee_amount,
            COUNT(*)::bigint AS fee_tx_count,
            NOW() AS updated_at
          FROM public.fee_ledger_entries l
          JOIN public.transactions t
            ON t.id = l.transaction_id
          JOIN public.users u
            ON u.id = t.destination_user_id
           AND u.role = 'MERCHANT'
          WHERE l.created_at >= $1
            AND l.created_at < $2
            AND l.fee_type = 'QR_FEE'
            AND l.transaction_id IS NOT NULL
            AND t.status IN ('SUCCESS', 'COMPLETED')
            AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
            AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
          GROUP BY 1, 2, 3
          ON CONFLICT (bucket_day, merchant_id, transaction_type) DO UPDATE SET
            fee_amount   = EXCLUDED.fee_amount,
            fee_tx_count = EXCLUDED.fee_tx_count,
            updated_at   = NOW()
          `,
          [chunkStart, chunkEnd]
        );

        await client.query("COMMIT");
        totalTxUpserted += txRes.rowCount || 0;
        totalFeeUpserted += feeRes.rowCount || 0;
        if (!options.silent && chunkNo % 5 === 0) {
          console.log(
            `Chunk ${chunkNo} (${chunkStart.toISOString().slice(0, 10)}..${chunkEnd.toISOString().slice(0, 10)}): tx=${txRes.rowCount}, fee=${feeRes.rowCount}`
          );
        }

        if (typeof options.onAfterChunk === "function") {
          await options.onAfterChunk({ chunkNo, chunkStart, chunkEnd });
        }

        chunkStart = chunkEnd;
      }
    }

    if (typeof options.beforeSeal === "function") {
      await options.beforeSeal({ dashCutoff, reportCutoff });
    }

    // Step 4: Finalize/Seal under advisory locks — drain all dirty buckets captured during backfill & clear dirty_guard_until
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [DASHBOARD_ROLLUP_LOCK_KEY]);
    await client.query("SET LOCAL work_mem = '64MB'");
    await client.query("SET LOCAL lock_timeout = '5s'");

    const dashDirtyPopped = await client.query(`
      WITH popped AS (
        DELETE FROM public.aggregation_dirty_buckets
        WHERE domain = 'dashboard' AND bucket_ts < $1
        RETURNING bucket_ts
      )
      SELECT ARRAY(SELECT DISTINCT bucket_ts FROM popped ORDER BY 1 ASC) AS hours
    `, [dashCutoff]);
    const dashHours = dashDirtyPopped.rows[0]?.hours || [];
    if (dashHours.length > 0) {
      await client.query(
        `DELETE FROM public.dashboard_tx_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
        [dashHours]
      );
      await client.query(
        `
        INSERT INTO public.dashboard_tx_hourly (
          bucket_hour, transaction_type, status, tx_count, total_amount, updated_at
        )
        SELECT
          date_trunc('hour', t.created_at) AS bucket_hour,
          t.transaction_type::text AS transaction_type,
          t.status::text AS status,
          COUNT(*)::bigint AS tx_count,
          COALESCE(SUM(t.amount), 0)::numeric(22, 0) AS total_amount,
          NOW() AS updated_at
        FROM unnest($1::timestamptz[]) AS d(bucket_hour)
        JOIN public.transactions t
          ON t.created_at >= d.bucket_hour
         AND t.created_at < d.bucket_hour + INTERVAL '1 hour'
        WHERE t.created_at < $2
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, transaction_type, status) DO UPDATE SET
          tx_count = EXCLUDED.tx_count,
          total_amount = EXCLUDED.total_amount,
          updated_at = NOW()
        `,
        [dashHours, dashCutoff]
      );
    }
    await client.query(
      `
      UPDATE public.aggregation_rollup_state
      SET rollup_until = $1, dirty_guard_until = NULL, updated_at = NOW()
      WHERE domain = 'dashboard'
      `,
      [dashCutoff]
    );
    await client.query("COMMIT");

    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [REPORT_ROLLUP_LOCK_KEY]);
    await client.query("SET LOCAL work_mem = '64MB'");
    await client.query("SET LOCAL lock_timeout = '5s'");

    const repDirtyPopped = await client.query(`
      WITH popped AS (
        DELETE FROM public.aggregation_dirty_buckets
        WHERE domain = 'report_merchant' AND bucket_ts < $1
        RETURNING bucket_ts
      )
      SELECT ARRAY(SELECT DISTINCT bucket_ts FROM popped ORDER BY 1 ASC) AS buckets
    `, [reportCutoff]);
    const repBuckets = repDirtyPopped.rows[0]?.buckets || [];
    if (repBuckets.length > 0) {
      await reconcileReportDays(client, repBuckets, reportCutoff);
    }
    await client.query(
      `
      UPDATE public.aggregation_rollup_state
      SET rollup_until = $1, dirty_guard_until = NULL, updated_at = NOW()
      WHERE domain = 'report_merchant'
      `,
      [reportCutoff]
    );
    await client.query("COMMIT");

    // Step 5: Analyze new table & check QR_FEE attribution anomalies
    await client.query("ANALYZE public.report_merchant_financial_daily");
    await client.query("ANALYZE public.aggregation_rollup_state");

    const anomalyRes = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM public.fee_ledger_entries WHERE fee_type = 'QR_FEE' AND transaction_id IS NULL) AS qr_fee_null_tx_id,
        (SELECT COUNT(*)::int
         FROM public.fee_ledger_entries l
         JOIN public.transactions t ON t.id = l.transaction_id
         WHERE l.fee_type = 'QR_FEE'
           AND l.merchant_user_id IS DISTINCT FROM t.destination_user_id) AS qr_fee_merchant_mismatch,
        (SELECT COUNT(*)::int FROM public.report_merchant_financial_daily) AS daily_rows,
        pg_size_pretty(pg_total_relation_size('public.report_merchant_financial_daily')) AS daily_total_size,
        pg_size_pretty(pg_relation_size('public.report_merchant_financial_daily')) AS daily_table_size,
        pg_size_pretty(pg_indexes_size('public.report_merchant_financial_daily')) AS daily_index_size
    `);

    const elapsedSec = ((Date.now() - startedMs) / 1000).toFixed(2);
    const summary = {
      elapsedSec: Number(elapsedSec),
      dashCutoff: dashCutoff.toISOString(),
      reportCutoff: reportCutoff.toISOString(),
      drainInfo,
      reconciledMidBackfillDashHours: dashHours.length,
      reconciledMidBackfillReportDays: repBuckets.length,
      totalTxUpserted,
      totalFeeUpserted,
      ...anomalyRes.rows[0],
    };
    if (!options.silent) {
      console.log("Analytics v2 backfill completed:", JSON.stringify(summary, null, 2));
    }
    return summary;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const { Pool } = require("pg");
  const targetDb = process.env.BACKFILL_DB_NAME || process.env.DB_NAME;
  const runPool =
    targetDb === process.env.DB_NAME
      ? defaultPool
      : new Pool({
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT || 5432),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: targetDb,
          max: 6,
        });

  runAnalyticsV2Backfill(runPool, {
    preserveDashboardHourly: process.env.PRESERVE_DASH_HOURLY === "true",
  })
    .then(async () => {
      await runPool.end();
      if (runPool !== defaultPool) await defaultPool.end();
    })
    .catch(async (err) => {
      console.error("Analytics v2 backfill failed:", err);
      await runPool.end().catch(() => {});
      if (runPool !== defaultPool) await defaultPool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = {
  DASHBOARD_ROLLUP_LOCK_KEY,
  REPORT_ROLLUP_LOCK_KEY,
  computeDashboardTargetCutoff,
  computeReportTargetCutoff,
  waitForXidDrain,
  reconcileReportDays,
  runAnalyticsV2Backfill,
};
