const path = require("path");
const { performance } = require("perf_hooks");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const pool = require("../src/config/database");

const INDEX_SPECS = [
  {
    name: "idx_transactions_created_at_id",
    table: "transactions",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_created_at_id ON public.transactions (created_at DESC, id DESC)",
  },
  {
    name: "idx_users_role_created_at_id",
    table: "users",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role_created_at_id ON public.users (role, created_at DESC, id DESC)",
  },
  {
    name: "idx_user_kyc_user_latest",
    table: "user_kyc",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_kyc_user_latest ON public.user_kyc (user_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST)",
  },
  {
    name: "idx_lba_user_default_created_at",
    table: "linked_bank_accounts",
    ddl: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lba_user_default_created_at ON public.linked_bank_accounts (user_id, is_default DESC, created_at DESC)",
  },
];

async function main() {
  const client = await pool.connect();
  try {
    // Session-only memory boost for faster concurrent index build on 9.6M rows
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
        i.indisvalid,
        t.indexdef
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
    console.table(verify.rows.map(({ tablename, indexname, indisvalid }) => ({
      tablename,
      indexname,
      indisvalid,
    })));

    if (verify.rowCount !== INDEX_SPECS.length || verify.rows.some((r) => !r.indisvalid)) {
      throw new Error("One or more indexes are missing or invalid!");
    }

    for (const table of ["transactions", "users", "user_kyc", "linked_bank_accounts"]) {
      await client.query(`ANALYZE public.${table}`);
    }
    console.log("ANALYZE completed on all 4 tables.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Index creation failed:", err);
  process.exit(1);
});
