const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = require("../src/config/database");

const DASHBOARD_ROLLUP_LOCK_KEY = 2026111601;

async function main() {
  const client = await pool.connect();
  try {
    const cutoffRes = await client.query(`
      SELECT (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS cutoff
    `);
    const cutoff = cutoffRes.rows[0].cutoff;
    console.log("Target rollup_until (00:00 Asia/Ho_Chi_Minh):", cutoff.toISOString());

    const startMs = Date.now();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [DASHBOARD_ROLLUP_LOCK_KEY]);
    await client.query("SET LOCAL work_mem = '128MB'");

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
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(2);
    console.log(
      `Backfill committed in ${elapsedSec}s: inserted ${insertRes.rowCount} hourly bucket rows.`
    );

    // Reconcile dirty hours in case an OLTP mutation happened right after COMMIT
    const dirtyCheck = await pool.query(
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

    console.table(dirtyCheck.rows);

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
    console.log(
      `Reconciliation PASSED 100%: total_count=${totalRollupCount}, total_amount=${totalRollupAmount}`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
