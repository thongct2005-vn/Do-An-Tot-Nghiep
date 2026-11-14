const pool = require("../../config/database");

const DASHBOARD_ROLLUP_LOCK_KEY = 2026111601;

let inFlightReconcile = null;

/**
 * Đọc trạng thái mốc rollup_until và kiểm tra nhanh xem có dirty hour cần đối soát hay không.
 */
async function getRollupState(db = pool) {
  try {
    const { rows } = await db.query(`
      SELECT
        rollup_until,
        (rollup_until > '-infinity'::timestamptz AND rollup_until < 'infinity'::timestamptz) AS is_finite,
        EXISTS (SELECT 1 FROM public.dashboard_dirty_hours LIMIT 1) AS has_dirty
      FROM public.dashboard_rollup_state
      WHERE id = 1
    `);

    if (!rows[0]) {
      return { rollupUntil: null, isFinite: false, hasDirty: false };
    }

    const row = rows[0];
    return {
      rollupUntil: row.is_finite ? row.rollup_until : null,
      isFinite: Boolean(row.is_finite),
      hasDirty: Boolean(row.has_dirty),
    };
  } catch (err) {
    // Dự phòng nếu môi trường test chưa chạy migration bảng rollup
    if (err && err.code === "42P01") {
      return { rollupUntil: null, isFinite: false, hasDirty: false };
    }
    throw err;
  }
}

/**
 * Đối soát các giờ bị đánh dấu dirty trong dashboard_dirty_hours bằng pg_advisory_xact_lock.
 */
async function reconcileDirtyHours(db = pool) {
  if (db === pool && inFlightReconcile) {
    return inFlightReconcile;
  }

  const run = async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        DASHBOARD_ROLLUP_LOCK_KEY,
      ]);

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
          `
          DELETE FROM public.dashboard_tx_hourly
          WHERE bucket_hour = ANY($1::timestamptz[])
          `,
          [hours]
        );

        if (isFinite && rollupUntil) {
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
      }

      await client.query("COMMIT");
      return {
        rollupUntil,
        reconciledHours: Array.isArray(hours) ? hours.length : 0,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  if (db !== pool) {
    return run();
  }

  inFlightReconcile = run().finally(() => {
    inFlightReconcile = null;
  });
  return inFlightReconcile;
}

/**
 * Đảm bảo mọi giờ dirty đã được đối soát trước khi đọc Hybrid, trả về rollupUntil hiện tại.
 */
async function ensureRollupConsistent(db = pool) {
  const state = await getRollupState(db);
  if (!state.hasDirty) {
    return state.rollupUntil;
  }
  const result = await reconcileDirtyHours(db);
  return result.rollupUntil;
}

/**
 * Cuộn mốc rollup_until về 00:00 hôm nay theo Asia/Ho_Chi_Minh nếu đã bước sang ngày mới.
 * Mỗi bước cuộn tối đa 7 ngày để giữ lock ngắn và an toàn nếu chạy lặp lại.
 */
async function advanceRollupCutoff(db = pool) {
  await reconcileDirtyHours(db);

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
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
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
  getRollupState,
  reconcileDirtyHours,
  ensureRollupConsistent,
  advanceRollupCutoff,
  computeHybridWindow,
};
