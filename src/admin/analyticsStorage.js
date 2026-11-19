const pool = require("../config/database");
const { httpError } = require("../utils/httpError");

const VALID_MODES = new Set(["v1", "v2", "raw"]);

const REQUIRED_RELATIONS_BY_MODE = Object.freeze({
  v1: [
    "public.dashboard_tx_hourly",
    "public.dashboard_rollup_state",
    "public.dashboard_dirty_hours",
    "public.report_merchant_tx_hourly",
    "public.report_merchant_fee_hourly",
    "public.report_gateway_hourly",
    "public.report_rollup_state",
    "public.report_dirty_hours",
  ],
  v2: [
    "public.dashboard_tx_hourly",
    "public.report_merchant_financial_daily",
    "public.aggregation_rollup_state",
    "public.aggregation_dirty_buckets",
  ],
});

const V2_TRIGGER_NAMES = Object.freeze([
  "trg_transactions_dashboard_dirty_v2",
  "trg_tx_report_dirty_ins_v2",
  "trg_tx_report_dirty_upd_v2",
  "trg_tx_report_dirty_del_v2",
  "trg_fee_ledger_report_dirty_ins_v2",
  "trg_fee_ledger_report_dirty_upd_v2",
  "trg_fee_ledger_report_dirty_del_v2",
]);

function getAnalyticsStorageMode(env = process.env) {
  const raw = env.ANALYTICS_STORAGE_MODE;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    // Keep v1 as safe default throughout Step 5A/5B until explicitly flipped in Step 5C.
    return "v1";
  }
  const normalized = String(raw).trim().toLowerCase();
  if (!VALID_MODES.has(normalized)) {
    throw new Error(
      `Invalid ANALYTICS_STORAGE_MODE "${raw}". Expected one of: v1, v2, raw.`
    );
  }
  return normalized;
}

function isMissingRollupFallbackAllowed(env = process.env) {
  const raw = env.ALLOW_MISSING_ROLLUP_FALLBACK;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    return String(raw).trim().toLowerCase() === "true";
  }
  return env.NODE_ENV === "test";
}

function isMissingRelationError(err) {
  return Boolean(err && err.code === "42P01");
}

function handleMissingRollupRelation(
  err,
  { domain = "unknown", relation = "unknown", mode = getAnalyticsStorageMode() } = {}
) {
  if (!isMissingRelationError(err)) {
    throw err;
  }

  const allowFallback = isMissingRollupFallbackAllowed();
  const logPayload = {
    tag: "ANALYTICS_ROLLUP_42P01",
    level: allowFallback ? "WARN" : "ERROR",
    domain,
    relation,
    mode,
    allowMissingRollupFallback: allowFallback,
    code: err.code,
    message: err.message,
  };

  if (allowFallback) {
    console.warn("[ANALYTICS_ROLLUP_42P01]", JSON.stringify(logPayload));
    return true;
  }

  console.error("[ANALYTICS_ROLLUP_42P01]", JSON.stringify(logPayload));
  throw httpError(
    503,
    "Hệ thống dữ liệu thống kê (Rollup) chưa sẵn sàng. Vui lòng kiểm tra trạng thái migration."
  );
}

async function retryOnLockConflict(
  fn,
  { maxRetries = 3, baseDelayMs = 50, jitterMs = 25 } = {}
) {
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      const retryable = err && (err.code === "40P01" || err.code === "55P03");
      if (retryable && attempt < maxRetries) {
        attempt += 1;
        const delayMs =
          baseDelayMs * attempt + Math.floor(Math.random() * jitterMs);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

async function waitForClientXidDrain(db, guardCommittedAt, maxWaitMs = 5000) {
  if (!guardCommittedAt) {
    return { drained: true, waitedMs: 0 };
  }
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

async function getAnalyticsRollupHealth(
  db = pool,
  {
    dirtyBacklogThresholdSec = 180,
    guardStaleThresholdSec = 300,
    modeOverride = null,
  } = {}
) {
  const mode = modeOverride || getAnalyticsStorageMode();
  if (mode === "raw") {
    return {
      healthy: true,
      status: "raw_mode",
      mode,
      allowMissingRollupFallback: isMissingRollupFallbackAllowed(),
      missingRelations: [],
      warnings: [],
      domains: {},
    };
  }

  const required = REQUIRED_RELATIONS_BY_MODE[mode];
  const regRes = await db.query(
    `
    SELECT rel, to_regclass(rel)::text AS reg_name
    FROM unnest($1::text[]) AS t(rel)
    `,
    [required]
  );

  const missingRelations = regRes.rows
    .filter((r) => !r.reg_name)
    .map((r) => r.rel);
  const warnings = [];

  if (missingRelations.length > 0) {
    warnings.push(`MISSING_RELATIONS:${missingRelations.join(",")}`);
    return {
      healthy: false,
      status: "degraded",
      mode,
      allowMissingRollupFallback: isMissingRollupFallbackAllowed(),
      missingRelations,
      warnings,
      domains: {},
    };
  }

  const domains = {};

  if (mode === "v1") {
    const stateRes = await db.query(`
      SELECT
        'dashboard' AS domain,
        s.rollup_until,
        (s.rollup_until > '-infinity'::timestamptz AND s.rollup_until < 'infinity'::timestamptz) AS is_finite,
        EXTRACT(EPOCH FROM (NOW() - s.rollup_until))::bigint AS lag_sec,
        (SELECT COUNT(*)::int FROM public.dashboard_dirty_hours) AS dirty_count,
        (SELECT EXTRACT(EPOCH FROM (NOW() - MIN(marked_at)))::bigint FROM public.dashboard_dirty_hours) AS oldest_dirty_age_sec
      FROM public.dashboard_rollup_state s
      WHERE s.id = 1
      UNION ALL
      SELECT
        'report_merchant' AS domain,
        s.rollup_until,
        (s.rollup_until > '-infinity'::timestamptz AND s.rollup_until < 'infinity'::timestamptz) AS is_finite,
        EXTRACT(EPOCH FROM (NOW() - s.rollup_until))::bigint AS lag_sec,
        (SELECT COUNT(*)::int FROM public.report_dirty_hours) AS dirty_count,
        (SELECT EXTRACT(EPOCH FROM (NOW() - MIN(marked_at)))::bigint FROM public.report_dirty_hours) AS oldest_dirty_age_sec
      FROM public.report_rollup_state s
      WHERE s.id = 1
    `);

    for (const r of stateRes.rows) {
      const oldestAge = r.oldest_dirty_age_sec != null ? Number(r.oldest_dirty_age_sec) : 0;
      if (oldestAge > dirtyBacklogThresholdSec) {
        warnings.push(`DIRTY_BACKLOG_${r.domain.toUpperCase()}:${oldestAge}s`);
      }
      domains[r.domain] = {
        rollupUntil: r.is_finite ? r.rollup_until : null,
        isFinite: Boolean(r.is_finite),
        lagSec: r.is_finite ? Number(r.lag_sec) : null,
        dirtyCount: Number(r.dirty_count || 0),
        oldestDirtyAgeSec: oldestAge,
      };
    }

    return {
      healthy: warnings.length === 0,
      status: warnings.length === 0 ? "healthy" : "degraded",
      mode,
      allowMissingRollupFallback: isMissingRollupFallbackAllowed(),
      missingRelations: [],
      warnings,
      domains,
    };
  }

  // mode === "v2"
  const colRes = await db.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'aggregation_rollup_state'
      AND column_name = 'triggers_paused_at'
  `);
  const hasPausedCol = colRes.rowCount > 0;

  const stateRes = await db.query(`
    SELECT
      s.domain,
      s.rollup_until,
      (s.rollup_until > '-infinity'::timestamptz AND s.rollup_until < 'infinity'::timestamptz) AS is_finite,
      s.dirty_guard_until,
      ${hasPausedCol ? "s.triggers_paused_at" : "NULL::timestamptz AS triggers_paused_at"},
      EXTRACT(EPOCH FROM (NOW() - s.updated_at))::bigint AS state_age_sec,
      EXTRACT(EPOCH FROM (NOW() - s.rollup_until))::bigint AS lag_sec,
      COALESCE(d.dirty_count, 0)::int AS dirty_count,
      d.oldest_dirty_age_sec::bigint AS oldest_dirty_age_sec
    FROM public.aggregation_rollup_state s
    LEFT JOIN (
      SELECT
        domain,
        COUNT(*) AS dirty_count,
        EXTRACT(EPOCH FROM (NOW() - MIN(marked_at))) AS oldest_dirty_age_sec
      FROM public.aggregation_dirty_buckets
      GROUP BY domain
    ) d ON d.domain = s.domain
    ORDER BY s.domain
  `);

  for (const r of stateRes.rows) {
    const oldestAge = r.oldest_dirty_age_sec != null ? Number(r.oldest_dirty_age_sec) : 0;
    if (!r.is_finite) {
      warnings.push(`WATERMARK_UNINITIALIZED_${r.domain.toUpperCase()}`);
    }
    if (oldestAge > dirtyBacklogThresholdSec) {
      warnings.push(`DIRTY_BACKLOG_${r.domain.toUpperCase()}:${oldestAge}s`);
    }
    if (r.dirty_guard_until && Number(r.state_age_sec || 0) > guardStaleThresholdSec) {
      warnings.push(`STALE_DIRTY_GUARD_${r.domain.toUpperCase()}:${r.state_age_sec}s`);
    }
    if (r.triggers_paused_at) {
      warnings.push(`TRIGGERS_PAUSED_${r.domain.toUpperCase()}`);
    }
    domains[r.domain] = {
      rollupUntil: r.is_finite ? r.rollup_until : null,
      isFinite: Boolean(r.is_finite),
      dirtyGuardUntil: r.dirty_guard_until || null,
      triggersPausedAt: r.triggers_paused_at || null,
      lagSec: r.is_finite ? Number(r.lag_sec) : null,
      dirtyCount: Number(r.dirty_count || 0),
      oldestDirtyAgeSec: oldestAge,
    };
  }

  const trgRes = await db.query(
    `
    SELECT tgname, tgenabled::text AS enabled_mode
    FROM pg_trigger tr
    JOIN pg_class c ON c.oid = tr.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT tr.tgisinternal
      AND tgname = ANY($1::text[])
    `,
    [V2_TRIGGER_NAMES]
  );

  const trgMap = Object.fromEntries(trgRes.rows.map((r) => [r.tgname, r.enabled_mode]));
  const missingTriggers = V2_TRIGGER_NAMES.filter((name) => !trgMap[name]);
  const disabledTriggers = V2_TRIGGER_NAMES.filter((name) => trgMap[name] === "D");

  if (missingTriggers.length > 0) {
    warnings.push(`MISSING_V2_TRIGGERS:${missingTriggers.join(",")}`);
  }
  if (disabledTriggers.length > 0) {
    warnings.push(`DISABLED_V2_TRIGGERS:${disabledTriggers.join(",")}`);
  }

  return {
    healthy: warnings.length === 0,
    status: warnings.length === 0 ? "healthy" : "degraded",
    mode,
    allowMissingRollupFallback: isMissingRollupFallbackAllowed(),
    missingRelations: [],
    missingTriggers,
    disabledTriggers,
    warnings,
    domains,
  };
}

module.exports = {
  V2_TRIGGER_NAMES,
  getAnalyticsStorageMode,
  isMissingRollupFallbackAllowed,
  isMissingRelationError,
  handleMissingRollupRelation,
  retryOnLockConflict,
  waitForClientXidDrain,
  getAnalyticsRollupHealth,
};
