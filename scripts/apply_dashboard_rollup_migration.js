const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const pool = require("../src/config/database");

async function main() {
  const sqlPath = path.join(
    __dirname,
    "../migrations/20261116_dashboard_tx_hourly_rollup.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8");

  const client = await pool.connect();
  try {
    console.log("Applying migration 20261116_dashboard_tx_hourly_rollup.sql...");
    await client.query(sql);
    console.log("DDL applied successfully.");

    // Verify tables, state, and trigger behavior cleanly inside a rolled-back test transaction
    await client.query("BEGIN");
    await client.query(`
      UPDATE public.dashboard_rollup_state
      SET rollup_until = '2026-06-01T00:00:00.000Z'::timestamptz
      WHERE id = 1
    `);

    const inserted = await client.query(`
      INSERT INTO public.transactions (transaction_type, amount, status, created_at)
      VALUES ('TOPUP', 1000, 'PENDING', '2026-05-01T10:15:00.000Z'::timestamptz)
      RETURNING id
    `);
    const txId = inserted.rows[0].id;

    const dirtyInsert = await client.query(`
      SELECT bucket_hour FROM public.dashboard_dirty_hours
      WHERE bucket_hour = '2026-05-01T10:00:00.000Z'::timestamptz
    `);
    if (dirtyInsert.rowCount !== 1) {
      throw new Error("Trigger failed to record dirty hour on historical INSERT");
    }

    await client.query(`DELETE FROM public.dashboard_dirty_hours`);
    await client.query(
      `UPDATE public.transactions SET status = 'FAILED' WHERE id = $1`,
      [txId],
    );
    const dirtyUpdate = await client.query(`
      SELECT bucket_hour FROM public.dashboard_dirty_hours
      WHERE bucket_hour = '2026-05-01T10:00:00.000Z'::timestamptz
    `);
    if (dirtyUpdate.rowCount !== 1) {
      throw new Error("Trigger failed to record dirty hour on historical UPDATE");
    }

    await client.query("ROLLBACK");
    console.log("Trigger verification (INSERT + UPDATE rollback test): PASSED");

    const checkRes = await client.query(`
      SELECT
        to_regclass('public.dashboard_tx_hourly')::text AS hourly_table,
        to_regclass('public.dashboard_rollup_state')::text AS state_table,
        to_regclass('public.dashboard_dirty_hours')::text AS dirty_table,
        (SELECT rollup_until FROM public.dashboard_rollup_state WHERE id = 1) AS rollup_until
    `);
    console.log("Verified objects:", checkRes.rows[0]);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
