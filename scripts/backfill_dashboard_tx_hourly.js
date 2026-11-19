const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = require("../src/config/database");

const DASHBOARD_ROLLUP_LOCK_KEY = 2026111601;

async function waitForInflightXids(db, xGuardResRow, maxWaitMs = 5000) {
  if (!xGuardResRow || xGuardResRow.x_xmax === undefined || xGuardResRow.x_xmax === null) {
    return { drained: true, waitedMs: 0 };
  }
  const start = Date.now();
  const xGuard = String(xGuardResRow.x_xmax);
  while (Date.now() - start < maxWaitMs) {
    const check = await db.query(
      `SELECT (pg_snapshot_xmin(pg_current_snapshot())::text::xid8 >= $1::xid8) AS drained`,
      [xGuard]
    );
    if (check.rows[0]?.drained) {
      return { drained: true, waitedMs: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return { drained: false, waitedMs: Date.now() - start };
}

async function runDashboardBackfill(db = pool, options = {}) {
  const client = await db.connect();
  try {
    let cutoff = options.cutoff ? new Date(options.cutoff) : null;
    if (!cutoff) {
      const cutoffRes = await client.query(`
        SELECT (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS cutoff
      `);
      cutoff = cutoffRes.rows[0].cutoff;
    }

    if (!options.silent) {
      console.log("Target rollup_until (00:00 Asia/Ho_Chi_Minh):", cutoff.toISOString());
    }

    const startMs = Date.now();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [DASHBOARD_ROLLUP_LOCK_KEY]);
    await client.query("SET LOCAL work_mem = '128MB'");
    await client.query("SET LOCAL lock_timeout = '5s'");

    await client.query("TRUNCATE TABLE public.dashboard_tx_hourly");
    await client.query("TRUNCATE TABLE public.dashboard_dirty_hours");

    const insertRes = await client.query(
      `
      INSERT INTO public.dashboard_tx_hourly (
        bucket_hour,
        transaction_type,
        status,
        tx_count,
        total_amount,
        updated_at
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
      `,
      [cutoff]
    );

    if (typeof options.beforeWatermarkCommit === "function") {
      await options.beforeWatermarkCommit({ cutoff });
    }

    await client.query(
      `
      INSERT INTO public.dashboard_rollup_state (id, rollup_until, updated_at)
      VALUES (1, $1, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        rollup_until = EXCLUDED.rollup_until,
        updated_at = NOW()
      `,
      [cutoff]
    );

    await client.query("COMMIT");

    const guardRes = await db.query(
      `SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS x_xmax`
    );
    const drainInfo = await waitForInflightXids(
      db,
      guardRes.rows[0],
      options.maxXidWaitMs ?? 5000
    );

    // Phase 2 catch-up: repair any historical buckets mutated mid-Tx1 before rollup_until was visible,
    // plus any dirty hours already captured by trg_transactions_dashboard_dirty.
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [DASHBOARD_ROLLUP_LOCK_KEY]);
    await client.query("SET LOCAL work_mem = '128MB'");
    await client.query("SET LOCAL lock_timeout = '5s'");

    const poppedDirty = await client.query(`
      DELETE FROM public.dashboard_dirty_hours
      RETURNING bucket_hour
    `);

    const deltaHoursRes = await client.query(
      `
      WITH raw_h AS (
        SELECT
          date_trunc('hour', created_at) AS bucket_hour,
          transaction_type::text AS transaction_type,
          status::text AS status,
          COUNT(*)::bigint AS tx_count,
          COALESCE(SUM(amount), 0)::numeric(22, 0) AS total_amount
        FROM public.transactions
        WHERE created_at < $1
        GROUP BY 1, 2, 3
      ),
      cur_h AS (
        SELECT bucket_hour, transaction_type, status, tx_count, total_amount
        FROM public.dashboard_tx_hourly
        WHERE bucket_hour < $1
      ),
      mismatched_buckets AS (
        SELECT DISTINCT COALESCE(r.bucket_hour, c.bucket_hour) AS bucket_hour
        FROM raw_h r
        FULL OUTER JOIN cur_h c
          ON r.bucket_hour = c.bucket_hour
         AND r.transaction_type = c.transaction_type
         AND r.status = c.status
        WHERE r.tx_count IS DISTINCT FROM c.tx_count
           OR r.total_amount IS DISTINCT FROM c.total_amount
      )
      SELECT ARRAY(
        SELECT DISTINCT bucket_hour
        FROM (
          SELECT bucket_hour FROM mismatched_buckets
          UNION ALL
          SELECT unnest($2::timestamptz[]) AS bucket_hour
        ) u
        WHERE bucket_hour < $1
        ORDER BY bucket_hour ASC
      ) AS hours
      `,
      [cutoff, poppedDirty.rows.map((r) => r.bucket_hour)]
    );

    const repairHours = deltaHoursRes.rows[0]?.hours || [];
    if (repairHours.length > 0) {
      await client.query(
        `DELETE FROM public.dashboard_tx_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
        [repairHours]
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
        WHERE d.bucket_hour < $2
          AND t.created_at < $2
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, transaction_type, status) DO UPDATE SET
          tx_count = EXCLUDED.tx_count,
          total_amount = EXCLUDED.total_amount,
          updated_at = NOW()
        `,
        [repairHours, cutoff]
      );
    }

    await client.query("COMMIT");

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(2);
    if (!options.silent) {
      console.log(
        `Backfill committed in ${elapsedSec}s: inserted ${insertRes.rowCount} hourly rows; catch-up repaired ${repairHours.length} buckets (xidDrained=${drainInfo.drained}, waitMs=${drainInfo.waitedMs}).`
      );
    }

    // Reconcile summary verification across closed window [min, cutoff)
    const dirtyCheck = await db.query(
      `
      SELECT
        COALESCE(r.transaction_type, t.transaction_type) AS transaction_type,
        COALESCE(r.status, t.status) AS status,
        COALESCE(t.tx_count, 0)::bigint AS raw_count,
        COALESCE(r.tx_count, 0)::bigint AS rollup_count,
        COALESCE(t.total_amount, 0)::numeric(22, 0)::text AS raw_amount,
        COALESCE(r.total_amount, 0)::numeric(22, 0)::text AS rollup_amount
      FROM (
        SELECT
          transaction_type::text AS transaction_type,
          status::text AS status,
          COUNT(*)::bigint AS tx_count,
          COALESCE(SUM(amount), 0)::numeric(22, 0) AS total_amount
        FROM public.transactions
        WHERE created_at < $1
        GROUP BY 1, 2
      ) t
      FULL OUTER JOIN (
        SELECT
          transaction_type,
          status,
          SUM(tx_count)::bigint AS tx_count,
          SUM(total_amount)::numeric(22, 0) AS total_amount
        FROM public.dashboard_tx_hourly
        WHERE bucket_hour < $1
        GROUP BY 1, 2
      ) r
        ON t.transaction_type = r.transaction_type AND t.status = r.status
      ORDER BY 1, 2
      `,
      [cutoff]
    );

    if (!options.silent) {
      console.table(dirtyCheck.rows);
    }

    const mismatches = dirtyCheck.rows.filter(
      (row) => row.raw_count !== row.rollup_count || row.raw_amount !== row.rollup_amount
    );

    if (mismatches.length > 0) {
      throw new Error(`Reconciliation mismatch detected: ${JSON.stringify(mismatches)}`);
    }

    const totalRollupCount = dirtyCheck.rows.reduce(
      (acc, r) => acc + BigInt(r.rollup_count),
      0n
    );
    const totalRollupAmount = dirtyCheck.rows.reduce(
      (acc, r) => acc + BigInt(r.rollup_amount),
      0n
    );
    if (!options.silent) {
      console.log(
        `Reconciliation PASSED 100%: total_count=${totalRollupCount}, total_amount=${totalRollupAmount}`
      );
    }

    return {
      cutoff,
      insertedRows: insertRes.rowCount,
      repairedBuckets: repairHours.length,
      totalRollupCount,
      totalRollupAmount,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runDashboardBackfill(pool)
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error("Backfill failed:", err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { runDashboardBackfill };
