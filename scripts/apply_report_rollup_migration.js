const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const pool = require("../src/config/database");

async function main() {
  const sqlPath = path.join(
    __dirname,
    "../migrations/20261124_report_hybrid_rollup.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8");

  const client = await pool.connect();
  try {
    console.log("Applying migration 20261124_report_hybrid_rollup.sql...");
    await client.query(sql);
    console.log("DDL applied successfully.");

    // Verify triggers on historical INSERT / UPDATE cleanly inside a rolled-back transaction
    await client.query("BEGIN");
    await client.query(`
      UPDATE public.report_rollup_state
      SET rollup_until = '2026-06-01T00:00:00.000Z'::timestamptz
      WHERE id = 1
    `);

    const merchantRes = await client.query(
      `SELECT id FROM public.users WHERE role = 'MERCHANT' LIMIT 1`,
    );
    const feeWalletRes = await client.query(
      `SELECT id FROM public.users WHERE role = 'SYSTEM' LIMIT 1`,
    );
    const merchantId = merchantRes.rows[0]?.id;
    const feeWalletId = feeWalletRes.rows[0]?.id;
    if (!merchantId || !feeWalletId) {
      throw new Error("Missing sample merchant or system user for trigger check");
    }

    const txId = `trig-${randomUUID().slice(0, 12)}`;
    await client.query(
      `
      INSERT INTO public.transactions (
        id, destination_user_id, transaction_type, amount, merchant_fee, status, created_at
      )
      VALUES ($1, $2, 'PAYMENT', 50000, 500, 'PENDING', '2026-05-01T10:15:00.000Z'::timestamptz)
      `,
      [txId, merchantId],
    );

    await client.query(
      `
      INSERT INTO public.fee_ledger_entries (
        id, transaction_id, merchant_user_id, fee_type, amount,
        fee_wallet_user_id, fee_wallet_balance_before, fee_wallet_balance_after, created_at
      )
      VALUES ($1, $2, $3, 'QR_FEE', 500, $4, 0, 500, '2026-05-02T03:20:00.000Z'::timestamptz)
      `,
      [randomUUID(), txId, merchantId, feeWalletId],
    );

    const prId = randomUUID();
    await client.query(
      `
      INSERT INTO public.payment_requests (
        id, reference_code, destination_user_id, amount, status, order_id, created_at
      )
      VALUES ($1, $2, $3, 50000, 'PENDING', $4, '2026-05-03T07:45:00.000Z'::timestamptz)
      `,
      [prId, `R-${txId}`, merchantId, `O-${txId}`],
    );

    await client.query(`DELETE FROM public.report_dirty_hours`);
    // Updating historical transaction status & payment request status should mark all 3 domains dirty
    await client.query(
      `UPDATE public.transactions SET status = 'SUCCESS' WHERE id = $1`,
      [txId],
    );
    await client.query(
      `UPDATE public.payment_requests SET status = 'SUCCESS' WHERE id = $1`,
      [prId],
    );

    const dirtyRows = await client.query(`
      SELECT bucket_hour, dirty_fee, dirty_tx, dirty_gateway
      FROM public.report_dirty_hours
      ORDER BY bucket_hour
    `);
    const hasTxDirty = dirtyRows.rows.some(
      (r) =>
        new Date(r.bucket_hour).toISOString() === "2026-05-01T10:00:00.000Z" &&
        r.dirty_tx === true,
    );
    const hasCrossHourFeeDirty = dirtyRows.rows.some(
      (r) =>
        new Date(r.bucket_hour).toISOString() === "2026-05-02T03:00:00.000Z" &&
        r.dirty_fee === true,
    );
    const hasGatewayDirty = dirtyRows.rows.some(
      (r) =>
        new Date(r.bucket_hour).toISOString() === "2026-05-03T07:00:00.000Z" &&
        r.dirty_gateway === true,
    );
    if (!hasTxDirty || !hasCrossHourFeeDirty || !hasGatewayDirty) {
      throw new Error(
        `Trigger failed on dirty check: ${JSON.stringify(dirtyRows.rows)}`,
      );
    }

    await client.query("ROLLBACK");
    console.log("Trigger verification (tx + cross-hour fee + gateway + rollback): PASSED");

    const catalogCheck = await client.query(`
      SELECT
        to_regclass('public.report_merchant_fee_hourly')::text AS fee_hourly,
        to_regclass('public.report_merchant_tx_hourly')::text AS tx_hourly,
        to_regclass('public.report_gateway_hourly')::text AS gateway_hourly,
        to_regclass('public.report_rollup_state')::text AS state_table,
        to_regclass('public.report_dirty_hours')::text AS dirty_table,
        to_regclass('public.idx_report_fee_hourly_bucket_type')::text AS fee_bucket_idx,
        to_regclass('public.idx_report_tx_hourly_bucket_type')::text AS tx_bucket_idx,
        to_regclass('public.idx_report_gateway_hourly_order_bucket')::text AS gateway_idx,
        (SELECT COUNT(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE t.tgname LIKE 'trg_%_report_dirty_%' AND NOT t.tgisinternal) AS trigger_count
    `);
    console.table(catalogCheck.rows);

    const obj = catalogCheck.rows[0];
    if (
      !obj.fee_hourly ||
      !obj.tx_hourly ||
      !obj.gateway_hourly ||
      !obj.state_table ||
      !obj.dirty_table ||
      !obj.fee_bucket_idx ||
      !obj.tx_bucket_idx ||
      !obj.gateway_idx ||
      obj.trigger_count !== 9
    ) {
      throw new Error(`Catalog verification failed: ${JSON.stringify(obj)}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Report rollup migration failed:", err);
  process.exit(1);
});
