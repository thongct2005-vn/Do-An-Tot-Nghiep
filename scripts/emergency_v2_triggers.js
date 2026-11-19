const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const defaultPool = require("../src/config/database");
const {
  runAnalyticsV2Backfill,
} = require("./backfill_analytics_v2");

const V2_TRIGGERS = Object.freeze([
  { table: "transactions", trigger: "trg_transactions_dashboard_dirty_v2" },
  { table: "transactions", trigger: "trg_tx_report_dirty_ins_v2" },
  { table: "transactions", trigger: "trg_tx_report_dirty_upd_v2" },
  { table: "transactions", trigger: "trg_tx_report_dirty_del_v2" },
  { table: "fee_ledger_entries", trigger: "trg_fee_ledger_report_dirty_ins_v2" },
  { table: "fee_ledger_entries", trigger: "trg_fee_ledger_report_dirty_upd_v2" },
  { table: "fee_ledger_entries", trigger: "trg_fee_ledger_report_dirty_del_v2" },
]);

const DISABLE_SQL_PATH = path.join(
  __dirname,
  "../migrations/20261129_emergency_disable_v2_triggers.sql"
);
const ENABLE_SQL_PATH = path.join(
  __dirname,
  "../migrations/rollback/20261129_emergency_disable_v2_triggers.sql"
);

async function getLockBlockers(db) {
  try {
    const res = await db.query(`
      SELECT a.pid, a.state, a.application_name, LEFT(a.query, 120) AS query,
             c.relname AS relation, l.mode, l.granted
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      LEFT JOIN pg_class c ON c.oid = l.relation
      WHERE c.relname IN ('transactions', 'fee_ledger_entries', 'aggregation_rollup_state')
        AND a.pid <> pg_backend_pid()
      ORDER BY a.xact_start NULLS LAST
    `);
    return res.rows;
  } catch {
    return [];
  }
}

async function execTriggerSqlWithRetry(
  db,
  sqlText,
  { maxRetries = 3, lockTimeoutMs = 2000, retryDelayMs = 150 } = {}
) {
  let attempt = 0;
  while (true) {
    const client = await db.connect();
    try {
      await client.query(sqlText.replaceAll("SET LOCAL lock_timeout = '2s';", `SET LOCAL lock_timeout = '${Number(lockTimeoutMs)}ms';`));
      return { attempts: attempt + 1 };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const isLockErr = err && (err.code === "55P03" || err.code === "40P01");
      if (isLockErr && attempt < maxRetries) {
        attempt += 1;
        const jitter = Math.floor(Math.random() * 50);
        await new Promise((r) => setTimeout(r, retryDelayMs * attempt + jitter));
        continue;
      }
      if (isLockErr) {
        const blockers = await getLockBlockers(db);
        const wrapped = new Error(
          `TRIGGER_V2_LOCK_TIMEOUT (${err.code}) after ${attempt + 1} attempts: ${err.message}. Blockers=${JSON.stringify(blockers)}`
        );
        wrapped.code = err.code;
        wrapped.blockers = blockers;
        throw wrapped;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

async function getV2TriggerStatus(db = defaultPool) {
  const names = V2_TRIGGERS.map((item) => item.trigger);
  const trRes = await db.query(
    `
    SELECT c.relname AS table_name, tr.tgname AS trigger_name, tr.tgenabled::text AS enabled_mode
    FROM pg_trigger tr
    JOIN pg_class c ON c.oid = tr.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT tr.tgisinternal
      AND tr.tgname = ANY($1::text[])
    ORDER BY c.relname, tr.tgname
    `,
    [names]
  );

  let pausedAt = null;
  const reg = await db.query(
    `SELECT to_regclass('public.aggregation_rollup_state')::text AS reg`
  );
  if (reg.rows[0]?.reg) {
    const colCheck = await db.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'aggregation_rollup_state'
        AND column_name = 'triggers_paused_at'
    `);
    if (colCheck.rowCount > 0) {
      const pRes = await db.query(
        `SELECT MIN(triggers_paused_at) AS paused_at FROM public.aggregation_rollup_state`
      );
      pausedAt = pRes.rows[0]?.paused_at || null;
    }
  }

  return {
    triggers: trRes.rows,
    pausedAt,
    disabledCount: trRes.rows.filter((r) => r.enabled_mode === "D").length,
    enabledCount: trRes.rows.filter((r) => r.enabled_mode !== "D").length,
  };
}

async function disableV2Triggers(db = defaultPool, options = {}) {
  const sqlText = fs.readFileSync(DISABLE_SQL_PATH, "utf8");
  const execInfo = await execTriggerSqlWithRetry(db, sqlText, options);
  const status = await getV2TriggerStatus(db);
  return { ...execInfo, status };
}

async function enableV2TriggersAndReconcile(db = defaultPool, options = {}) {
  const beforeStatus = await getV2TriggerStatus(db);
  const enableSql = fs.readFileSync(ENABLE_SQL_PATH, "utf8");
  const execInfo = await execTriggerSqlWithRetry(db, enableSql, options);

  // Reconcile/backfill FULL v2 derived data across the unmonitored gap using Watermark Barrier + XID drain.
  // Rebuilding cleanly guarantees 0 missing rows even for DELETEs or UPDATEs without updated_at bumps.
  const backfillSummary = await runAnalyticsV2Backfill(db, {
    preserveDashboardHourly: false,
    ...options,
  });

  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'aggregation_rollup_state'
          AND column_name = 'triggers_paused_at'
      ) THEN
        UPDATE public.aggregation_rollup_state
        SET triggers_paused_at = NULL,
            updated_at = NOW();
      END IF;
    END
    $$;
  `);

  const afterStatus = await getV2TriggerStatus(db);
  return {
    ...execInfo,
    previouslyPausedAt: beforeStatus.pausedAt,
    backfillSummary,
    status: afterStatus,
  };
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const targetDb = process.env.TARGET_DB_NAME || process.env.DB_NAME;
  const { Pool } = require("pg");
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

  (async () => {
    if (args.has("--disable")) {
      const res = await disableV2Triggers(runPool);
      console.log("Disabled Analytics v2 triggers cleanly (v1 & constraints intact):", JSON.stringify(res, null, 2));
    } else if (args.has("--enable-and-reconcile")) {
      const res = await enableV2TriggersAndReconcile(runPool);
      console.log("Re-enabled Analytics v2 triggers and reconciled gap:", JSON.stringify(res, null, 2));
    } else {
      const res = await getV2TriggerStatus(runPool);
      console.log("Analytics v2 trigger status:", JSON.stringify(res, null, 2));
    }
  })()
    .then(async () => {
      await runPool.end();
      if (runPool !== defaultPool) await defaultPool.end();
    })
    .catch(async (err) => {
      console.error("Emergency v2 trigger operation failed:", err);
      await runPool.end().catch(() => {});
      if (runPool !== defaultPool) await defaultPool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = {
  V2_TRIGGERS,
  getV2TriggerStatus,
  disableV2Triggers,
  enableV2TriggersAndReconcile,
};
