const path = require("path");
const { performance } = require("perf_hooks");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const pool = require("../src/config/database");

const INDEX_SPECS = [
  {
    name: "idx_fee_ledger_qr_created_tx",
    table: "fee_ledger_entries",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_ledger_qr_created_tx ON public.fee_ledger_entries (created_at, transaction_id) INCLUDE (amount) WHERE fee_type = 'QR_FEE'",
  },
  {
    name: "idx_transactions_source_created_id",
    table: "transactions",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_source_created_id ON public.transactions (source_user_id, created_at DESC, id DESC)",
  },
  {
    name: "idx_transactions_dest_created_id_inc",
    table: "transactions",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_dest_created_id_inc ON public.transactions (destination_user_id, created_at DESC, id DESC) INCLUDE (amount, merchant_fee, transaction_type, status)",
  },
  {
    name: "idx_transactions_merchant_success_created",
    table: "transactions",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_merchant_success_created ON public.transactions (created_at, destination_user_id, transaction_type) INCLUDE (amount, merchant_fee) WHERE transaction_type IN ('PAYMENT', 'TRANSFER') AND status IN ('SUCCESS', 'COMPLETED')",
  },
  {
    name: "idx_pr_gateway_created_cohort",
    table: "payment_requests",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pr_gateway_created_cohort ON public.payment_requests (created_at, destination_user_id) INCLUDE (status) WHERE order_id IS NOT NULL",
  },
  {
    name: "idx_pr_dest_created_inc",
    table: "payment_requests",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pr_dest_created_inc ON public.payment_requests (destination_user_id, created_at DESC) INCLUDE (status, reference_code, transaction_id)",
  },
  {
    name: "idx_pr_transaction_id_inc",
    table: "payment_requests",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pr_transaction_id_inc ON public.payment_requests (transaction_id) INCLUDE (reference_code) WHERE transaction_id IS NOT NULL",
  },
  {
    name: "idx_admin_change_tx_id_created",
    table: "admin_user_change_history",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_change_tx_id_created ON public.admin_user_change_history ((new_values->>'transaction_id'), created_at DESC, id DESC) WHERE (new_values->>'transaction_id') IS NOT NULL",
  },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");
    await client.query("SET lock_timeout = '10s'");
    await client.query("SET maintenance_work_mem = '256MB'");

    for (const spec of INDEX_SPECS) {
      const invalidCheck = await client.query(
        `
        SELECT c.relname, i.indisvalid
        FROM pg_class c
        JOIN pg_index i ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1
        `,
        [spec.name],
      );
      if (invalidCheck.rowCount > 0 && !invalidCheck.rows[0].indisvalid) {
        console.log(`Dropping previous INVALID index ${spec.name}...`);
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS public.${spec.name}`);
      }

      const t0 = performance.now();
      console.log(`Creating ${spec.name} on ${spec.table}...`);
      await client.query(spec.ddl);
      console.log(`Done ${spec.name} in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
    }

    const indexNames = INDEX_SPECS.map((s) => s.name);
    const verify = await client.query(
      `
      SELECT
        t.tablename,
        c.relname AS indexname,
        i.indisvalid
      FROM pg_indexes t
      JOIN pg_class c ON c.relname = t.indexname
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
      JOIN pg_index i ON c.oid = i.indexrelid
      WHERE t.schemaname = 'public'
        AND t.indexname = ANY($1::text[])
      ORDER BY t.tablename, c.relname
      `,
      [indexNames],
    );
    console.table(verify.rows);

    if (verify.rowCount !== INDEX_SPECS.length || verify.rows.some((r) => !r.indisvalid)) {
      throw new Error("One or more indexes are missing or invalid!");
    }

    for (const table of [
      "fee_ledger_entries",
      "transactions",
      "payment_requests",
      "admin_user_change_history",
    ]) {
      await client.query(`ANALYZE public.${table}`);
    }
    console.log("ANALYZE completed on all 4 target tables.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Report/Admin perf index creation failed:", err);
  process.exit(1);
});
