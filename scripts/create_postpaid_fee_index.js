const path = require("path");
const { performance } = require("perf_hooks");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const pool = require("../src/config/database");

const INDEX_SPECS = [
  {
    name: "idx_fee_ledger_postpaid_created_tx",
    table: "fee_ledger_entries",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_ledger_postpaid_created_tx ON public.fee_ledger_entries (created_at, fee_type, transaction_id) INCLUDE (amount) WHERE fee_type IN ('POSTPAID_SERVICE_FEE', 'POSTPAID_LATE_FEE')",
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
      throw new Error("Postpaid fee ledger index is missing or invalid!");
    }

    await client.query("ANALYZE public.fee_ledger_entries");
    console.log("ANALYZE completed on public.fee_ledger_entries.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Postpaid fee index creation failed:", err);
  process.exit(1);
});
