const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = require("../src/config/database");

function splitSqlStatements(sql) {
  const withoutLineComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return withoutLineComments
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertNoTransactionBlock(statements) {
  for (const stmt of statements) {
    const upper = stmt.toUpperCase().replace(/\s+/g, " ").trim();
    if (/^(BEGIN|START TRANSACTION|COMMIT|END)(\b|$)/.test(upper)) {
      throw new Error(
        `Refusing concurrent index script containing explicit transaction control: "${stmt}"`
      );
    }
  }
}

async function runConcurrentMigration(sqlFilePath, verifyIndexes = []) {
  const fullPath = path.resolve(sqlFilePath);
  const rawSql = fs.readFileSync(fullPath, "utf8");
  const statements = splitSqlStatements(rawSql);
  assertNoTransactionBlock(statements);

  const client = await pool.connect();
  try {
    console.log(`Running autocommit statements from: ${fullPath}`);
    for (let i = 0; i < statements.length; i += 1) {
      const stmt = statements[i];
      console.log(`[${i + 1}/${statements.length}] ${stmt.slice(0, 120)}${stmt.length > 120 ? "..." : ""}`);
      await client.query(stmt);
    }

    if (verifyIndexes.length > 0) {
      const idxRes = await client.query(
        `
        SELECT c.relname AS indexname, i.indisvalid, i.indisready, pg_get_indexdef(c.oid) AS def
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname
        `,
        [verifyIndexes]
      );
      console.table(idxRes.rows);
      for (const name of verifyIndexes) {
        const found = idxRes.rows.find((r) => r.indexname === name);
        if (!found || !found.indisvalid) {
          throw new Error(`Index verification failed (missing or INVALID): ${name}`);
        }
      }
    }
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileArg = args[0];
  const verifyIdx = args.slice(1);
  if (!fileArg) {
    console.error("Usage: node run_concurrent_index_migration.js <sql-file> [verify-index-name...]");
    process.exit(1);
  }
  runConcurrentMigration(fileArg, verifyIdx)
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error("Concurrent migration failed:", err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { splitSqlStatements, assertNoTransactionBlock, runConcurrentMigration };
