const pool = require("../../config/database");
const {
  getAnalyticsStorageMode,
  handleMissingRollupRelation,
  retryOnLockConflict,
  waitForClientXidDrain,
  getAnalyticsRollupHealth,
} = require("../analyticsStorage");

const DASHBOARD_ROLLUP_LOCK_KEY = 2026111601;

let inFlightReconcile = null;
let inFlightEnsure = null;

async function computeDashboardTargetCutoff(db = pool) {
  const res = await db.query(
    `SELECT DATE_TRUNC('hour', NOW() - INTERVAL '1 hour') AS cutoff`
  );
  return new Date(res.rows[0].cutoff);
}

/**
 * Đọc trạng thái mốc rollup_until và kiểm tra nhanh xem có bucket dirty cần đối soát hay không.
 */
async function getRollupState(db = pool, options = {}) {
  const mode = options.storageMode || getAnalyticsStorageMode();
  if (mode === "raw") {
    return { rollupUntil: null, isFinite: false, hasDirty: false, mode };
  }

  try {
    if (mode === "v2") {
      const { rows } = await db.query(`
        SELECT
          rollup_until,
          (rollup_until > '-infinity'::timestamptz AND rollup_until < 'infinity'::timestamptz) AS is_finite,
          EXISTS (
            SELECT 1 FROM public.aggregation_dirty_buckets WHERE domain = 'dashboard' LIMIT 1
          ) AS has_dirty
        FROM public.aggregation_rollup_state
        WHERE domain = 'dashboard'
      `);
      if (!rows[0]) {
        return { rollupUntil: null, isFinite: false, hasDirty: false, mode };
      }
      const row = rows[0];
      return {
        rollupUntil: row.is_finite ? row.rollup_until : null,
        isFinite: Boolean(row.is_finite),
        hasDirty: Boolean(row.has_dirty),
        mode,
      };
    }

    const { rows } = await db.query(`
      SELECT
        rollup_until,
        (rollup_until > '-infinity'::timestamptz AND rollup_until < 'infinity'::timestamptz) AS is_finite,
        EXISTS (SELECT 1 FROM public.dashboard_dirty_hours LIMIT 1) AS has_dirty
      FROM public.dashboard_rollup_state
      WHERE id = 1
    `);

    if (!rows[0]) {
      return { rollupUntil: null, isFinite: false, hasDirty: false, mode };
    }

    const row = rows[0];
    return {
      rollupUntil: row.is_finite ? row.rollup_until : null,
      isFinite: Boolean(row.is_finite),
      hasDirty: Boolean(row.has_dirty),
      mode,
    };
  } catch (err) {
    if (err && err.code === "42P01") {
      handleMissingRollupRelation(err, {
        domain: "dashboard",
        relation: mode === "v2" ? "aggregation_rollup_state" : "dashboard_rollup_state",
        mode,
      });
      return { rollupUntil: null, isFinite: false, hasDirty: false, mode };
    }
    throw err;
  }
}

async function upsertDashboardHours(client, hours, rollupUntil) {
  await client.query(
    `DELETE FROM public.dashboard_tx_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
    [hours]
  );

  await client.query(
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
    ON CONFLICT (bucket_hour, transaction_type, status)
    DO UPDATE SET
      tx_count = EXCLUDED.tx_count,
      total_amount = EXCLUDED.total_amount,
      updated_at = NOW()
    `,
    [hours, rollupUntil]
  );
}

/**
 * Đối soát các giờ bị đánh dấu dirty bằng pg_advisory_xact_lock + lock_timeout + retry 40P01/55P03.
 */
async function reconcileDirtyHours(db = pool, options = {}) {
  const mode = options.storageMode || getAnalyticsStorageMode();
  if (mode === "raw") {
    return { rollupUntil: null, reconciledHours: 0, mode };
  }
  if (db === pool && inFlightReconcile) {
    return inFlightReconcile;
  }

  const run = async () =>
    retryOnLockConflict(async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [
          DASHBOARD_ROLLUP_LOCK_KEY,
        ]);

        if (mode === "v2") {
          await client.query("SET LOCAL lock_timeout = '3s'");
          await client.query("SET LOCAL statement_timeout = '30s'");

          const stateRes = await client.query(`
            SELECT
              rollup_until,
              (rollup_until > '-infinity'::timestamptz AND rollup_until < 'infinity'::timestamptz) AS is_finite
            FROM public.aggregation_rollup_state
            WHERE domain = 'dashboard'
          `);
          const isFinite = Boolean(stateRes.rows[0]?.is_finite);
          const rollupUntil = isFinite ? stateRes.rows[0].rollup_until : null;

          const poppedRes = await client.query(`
            WITH popped AS (
              DELETE FROM public.aggregation_dirty_buckets
              WHERE domain = 'dashboard'
              RETURNING bucket_ts
            )
            SELECT ARRAY(SELECT DISTINCT bucket_ts FROM popped ORDER BY 1 ASC) AS hours
          `);
          const hours = poppedRes.rows[0]?.hours || [];

          if (hours.length > 0 && isFinite && rollupUntil) {
            await upsertDashboardHours(client, hours, rollupUntil);
          }

          await client.query("COMMIT");
          return {
            rollupUntil,
            reconciledHours: hours.length,
            mode,
          };
        }

        const stateRes = await client.query(`
          SELECT
            rollup_until,
            (rollup_until > '-infinity'::timestamptz AND rollup_until < 'infinity'::timestamptz) AS is_finite
          FROM public.dashboard_rollup_state
          WHERE id = 1
        `);
        const isFinite = Boolean(stateRes.rows[0]?.is_finite);
        const rollupUntil = isFinite ? stateRes.rows[0].rollup_until : null;

        const poppedRes = await client.query(`
          WITH popped AS (
            DELETE FROM public.dashboard_dirty_hours
            RETURNING bucket_hour
          )
          SELECT ARRAY_AGG(DISTINCT bucket_hour) AS hours
          FROM popped
        `);
        const hours = poppedRes.rows[0]?.hours;

        if (Array.isArray(hours) && hours.length > 0) {
          await client.query(
            `DELETE FROM public.dashboard_tx_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
            [hours]
          );

          if (isFinite && rollupUntil) {
            const sortedHours = [...hours].sort(
              (a, b) => new Date(a).getTime() - new Date(b).getTime()
            );
            await client.query(
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
              ON CONFLICT (bucket_hour, transaction_type, status)
              DO UPDATE SET
                tx_count = EXCLUDED.tx_count,
                total_amount = EXCLUDED.total_amount,
                updated_at = NOW()
              `,
              [sortedHours, rollupUntil]
            );
          }
        }

        await client.query("COMMIT");
        return {
          rollupUntil,
          reconciledHours: Array.isArray(hours) ? hours.length : 0,
          mode,
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    });

  if (db !== pool) {
    return run();
  }

  inFlightReconcile = run().finally(() => {
    inFlightReconcile = null;
  });
  return inFlightReconcile;
}

/**
 * Đảm bảo mọi bucket dirty đã được đối soát trước khi đọc Hybrid, trả về rollupUntil hiện tại.
 */
async function ensureRollupConsistent(db = pool, options = {}) {
  const mode = options.storageMode || getAnalyticsStorageMode();
  if (mode === "raw") {
    return null;
  }
  if (db === pool && inFlightEnsure) {
    return inFlightEnsure;
  }

  const run = async () => {
    const state = await getRollupState(db, { storageMode: mode });
    if (!state.hasDirty) {
      return state.rollupUntil;
    }
    try {
      const result = await reconcileDirtyHours(db, { storageMode: mode });
      return result.rollupUntil;
    } catch (err) {
      if (err && err.code === "42P01") {
        handleMissingRollupRelation(err, {
          domain: "dashboard",
          relation: mode === "v2" ? "aggregation_dirty_buckets" : "dashboard_dirty_hours",
          mode,
        });
        return null;
      }
      throw err;
    }
  };

  if (db !== pool) {
    return run();
  }

  inFlightEnsure = run().finally(() => {
    inFlightEnsure = null;
  });
  return inFlightEnsure;
}

/**
 * Cuộn mốc rollup_until:
 * - v1: về 00:00 hôm nay theo Asia/Ho_Chi_Minh (tối đa 7 ngày/lần) giữ nguyên SQL tương thích unit test cũ.
 * - v2: về giờ UTC tròn đã đóng an toàn (DATE_TRUNC('hour', NOW() - INTERVAL '1 hour')) bằng Watermark Barrier + XID drain.
 */
async function advanceRollupCutoff(db = pool, options = {}) {
  const mode = options.storageMode || getAnalyticsStorageMode();
  if (mode === "raw") {
    return { rollupUntil: null, rolledUpRows: 0, skippedRawMode: true };
  }

  try {
    await reconcileDirtyHours(db, { storageMode: mode });
  } catch (err) {
    if (err && err.code === "42P01") {
      handleMissingRollupRelation(err, {
        domain: "dashboard",
        relation: mode === "v2" ? "aggregation_dirty_buckets" : "dashboard_dirty_hours",
        mode,
      });
      return { rollupUntil: null, rolledUpRows: 0, skippedMissingSchema: true };
    }
    throw err;
  }

  if (mode === "v2") {
    let totalRolledHours = 0;
    let latestRollupUntil = null;

    while (true) {
      const guardPrep = await retryOnLockConflict(async () => {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock($1)", [
            DASHBOARD_ROLLUP_LOCK_KEY,
          ]);
          await client.query("SET LOCAL lock_timeout = '3s'");

          const checkRes = await client.query(`
            SELECT
              s.rollup_until,
              (s.rollup_until > '-infinity'::timestamptz AND s.rollup_until < 'infinity'::timestamptz) AS is_finite,
              DATE_TRUNC('hour', NOW() - INTERVAL '1 hour') AS target_cutoff,
              LEAST(
                s.rollup_until + INTERVAL '7 days',
                DATE_TRUNC('hour', NOW() - INTERVAL '1 hour')
              ) AS next_cutoff
            FROM public.aggregation_rollup_state s
            WHERE s.domain = 'dashboard'
          `);

          const row = checkRes.rows[0];
          if (!row || !row.is_finite) {
            await client.query("COMMIT");
            return { done: true, currentUntil: null };
          }

          const currentUntil = new Date(row.rollup_until);
          const nextCutoff = new Date(row.next_cutoff);
          const targetCutoff = new Date(row.target_cutoff);

          if (!(currentUntil.getTime() < nextCutoff.getTime())) {
            await client.query("COMMIT");
            return { done: true, currentUntil };
          }

          await client.query(
            `
            UPDATE public.aggregation_rollup_state
            SET dirty_guard_until = $1, updated_at = NOW()
            WHERE domain = 'dashboard'
            `,
            [nextCutoff]
          );
          await client.query("COMMIT");
          const tsRes = await db.query(`SELECT clock_timestamp() AS guard_committed_at`);
          return {
            done: false,
            currentUntil,
            nextCutoff,
            targetCutoff,
            guardCommittedAt: tsRes.rows[0]?.guard_committed_at,
          };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          if (err && err.code === "42P01") {
            handleMissingRollupRelation(err, {
              domain: "dashboard",
              relation: "aggregation_rollup_state",
              mode,
            });
            return { skippedMissingSchema: true };
          }
          throw err;
        } finally {
          client.release();
        }
      });

      if (guardPrep.skippedMissingSchema) {
        return { rollupUntil: null, rolledUpRows: 0, skippedMissingSchema: true };
      }
      if (guardPrep.done) {
        if (guardPrep.currentUntil) latestRollupUntil = guardPrep.currentUntil;
        break;
      }

      const drainInfo = await waitForClientXidDrain(
        db,
        guardPrep.guardCommittedAt,
        options.maxXidWaitMs ?? 5000
      );
      if (!drainInfo.drained) {
        await db
          .query(
            `UPDATE public.aggregation_rollup_state SET dirty_guard_until = NULL, updated_at = NOW() WHERE domain = 'dashboard'`
          )
          .catch(() => {});
        return {
          rollupUntil: guardPrep.currentUntil,
          rolledUpRows: totalRolledHours,
          deferredXidDrain: true,
        };
      }

      const sealRes = await retryOnLockConflict(async () => {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock($1)", [
            DASHBOARD_ROLLUP_LOCK_KEY,
          ]);
          await client.query("SET LOCAL lock_timeout = '3s'");
          await client.query("SET LOCAL statement_timeout = '30s'");
          await client.query("SET LOCAL work_mem = '64MB'");

          await client.query(
            `DELETE FROM public.dashboard_tx_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
            [guardPrep.currentUntil, guardPrep.nextCutoff]
          );

          const upsertRes = await client.query(
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
            WHERE created_at >= $1 AND created_at < $2
            GROUP BY 1, 2, 3
            ON CONFLICT (bucket_hour, transaction_type, status)
            DO UPDATE SET
              tx_count = EXCLUDED.tx_count,
              total_amount = EXCLUDED.total_amount,
              updated_at = NOW()
            `,
            [guardPrep.currentUntil, guardPrep.nextCutoff]
          );

          const dirtyPopped = await client.query(
            `
            WITH popped AS (
              DELETE FROM public.aggregation_dirty_buckets
              WHERE domain = 'dashboard' AND bucket_ts < $1
              RETURNING bucket_ts
            )
            SELECT ARRAY(SELECT DISTINCT bucket_ts FROM popped ORDER BY 1 ASC) AS hours
            `,
            [guardPrep.nextCutoff]
          );
          const extraHours = dirtyPopped.rows[0]?.hours || [];
          if (extraHours.length > 0) {
            await upsertDashboardHours(client, extraHours, guardPrep.nextCutoff);
          }

          await client.query(
            `
            UPDATE public.aggregation_rollup_state
            SET rollup_until = $1, dirty_guard_until = NULL, updated_at = NOW()
            WHERE domain = 'dashboard'
            `,
            [guardPrep.nextCutoff]
          );

          await client.query("COMMIT");
          return upsertRes.rowCount || 0;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });

      totalRolledHours += sealRes;
      latestRollupUntil = guardPrep.nextCutoff;
      if (guardPrep.nextCutoff.getTime() >= guardPrep.targetCutoff.getTime()) {
        break;
      }
    }

    return {
      rollupUntil: latestRollupUntil,
      rolledUpRows: totalRolledHours,
      mode,
    };
  }

  // v1 legacy cutoff progression
  const client = await db.connect();
  try {
    let totalRolledHours = 0;
    let latestRollupUntil = null;

    while (true) {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        DASHBOARD_ROLLUP_LOCK_KEY,
      ]);

      const checkRes = await client.query(`
        SELECT
          s.rollup_until,
          (s.rollup_until > '-infinity'::timestamptz AND s.rollup_until < 'infinity'::timestamptz) AS is_finite,
          (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS target_cutoff,
          LEAST(
            s.rollup_until + INTERVAL '7 days',
            DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
          ) AS next_cutoff
        FROM public.dashboard_rollup_state s
        WHERE s.id = 1
      `);

      const row = checkRes.rows[0];
      if (!row || !row.is_finite) {
        await client.query("COMMIT");
        break;
      }

      const currentUntil = new Date(row.rollup_until);
      const nextCutoff = new Date(row.next_cutoff);
      latestRollupUntil = currentUntil;

      if (!(currentUntil.getTime() < nextCutoff.getTime())) {
        await client.query("COMMIT");
        break;
      }

      await client.query("SET LOCAL work_mem = '64MB'");

      await client.query(
        `
        DELETE FROM public.dashboard_tx_hourly
        WHERE bucket_hour >= $1 AND bucket_hour < $2
        `,
        [currentUntil, nextCutoff]
      );

      const upsertRes = await client.query(
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
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, transaction_type, status)
        DO UPDATE SET
          tx_count = EXCLUDED.tx_count,
          total_amount = EXCLUDED.total_amount,
          updated_at = NOW()
        `,
        [currentUntil, nextCutoff]
      );

      await client.query(
        `
        DELETE FROM public.dashboard_dirty_hours
        WHERE bucket_hour >= $1 AND bucket_hour < $2
        `,
        [currentUntil, nextCutoff]
      );

      await client.query(
        `
        UPDATE public.dashboard_rollup_state
        SET rollup_until = $1, updated_at = NOW()
        WHERE id = 1
        `,
        [nextCutoff]
      );

      await client.query("COMMIT");
      totalRolledHours += upsertRes.rowCount || 0;
      latestRollupUntil = nextCutoff;

      if (nextCutoff.getTime() >= new Date(row.target_cutoff).getTime()) {
        break;
      }
    }

    return {
      rollupUntil: latestRollupUntil,
      rolledUpRows: totalRolledHours,
      mode,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err && err.code === "42P01") {
      handleMissingRollupRelation(err, {
        domain: "dashboard",
        relation: "dashboard_rollup_state",
        mode,
      });
      return { rollupUntil: null, rolledUpRows: 0, skippedMissingSchema: true };
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Chia khoảng [startInstant, nextDayInstant) thành nửa rollup [startInstant, splitInstant)
 * và nửa raw transactions [splitInstant, nextDayInstant).
 */
function computeHybridWindow(startInstant, nextDayInstant, rollupUntil) {
  const startDate = new Date(startInstant);
  const nextDate = new Date(nextDayInstant);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(nextDate.getTime())) {
    return {
      useRollup: false,
      useTail: true,
      splitInstant: startInstant,
    };
  }

  if (nextDate.getTime() <= startDate.getTime()) {
    return {
      useRollup: false,
      useTail: false,
      splitInstant: nextDate,
    };
  }

  if (!rollupUntil) {
    return {
      useRollup: false,
      useTail: true,
      splitInstant: startDate,
    };
  }

  const rollupDate = new Date(rollupUntil);
  if (Number.isNaN(rollupDate.getTime())) {
    return {
      useRollup: false,
      useTail: true,
      splitInstant: startDate,
    };
  }

  const clampedMs = Math.min(
    Math.max(rollupDate.getTime(), startDate.getTime()),
    nextDate.getTime()
  );
  const splitInstant = new Date(clampedMs);

  return {
    useRollup: clampedMs > startDate.getTime(),
    useTail: clampedMs < nextDate.getTime(),
    splitInstant,
  };
}

module.exports = {
  DASHBOARD_ROLLUP_LOCK_KEY,
  computeDashboardTargetCutoff,
  getRollupState,
  reconcileDirtyHours,
  ensureRollupConsistent,
  advanceRollupCutoff,
  computeHybridWindow,
  getAnalyticsRollupHealth,
};
