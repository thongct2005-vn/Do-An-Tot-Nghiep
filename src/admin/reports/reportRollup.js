const pool = require("../../config/database");
const {
  getAnalyticsStorageMode,
  isMissingRelationError,
  handleMissingRollupRelation,
  retryOnLockConflict,
  waitForClientXidDrain,
  getAnalyticsRollupHealth,
} = require("../analyticsStorage");
const { computeHybridWindow } = require("../dashboard/dashboardRollup");

const REPORT_ROLLUP_LOCK_KEY = 2026111602;

let inFlightReconcile = null;

function makeParamAdder(params) {
  return (value) => {
    params.push(value);
    return `$${params.length}`;
  };
}

async function computeReportTargetCutoff(db = pool) {
  const res = await db.query(`
    SELECT (
      DATE_TRUNC('day', (NOW() - INTERVAL '1 minute') AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
    ) AS cutoff
  `);
  return new Date(res.rows[0].cutoff);
}

/**
 * Đọc mốc rollup_until và trạng thái dirty buckets của phân hệ Báo cáo.
 */
async function getReportRollupState(db = pool, options = {}) {
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
            SELECT 1 FROM public.aggregation_dirty_buckets WHERE domain = 'report_merchant' LIMIT 1
          ) AS has_dirty
        FROM public.aggregation_rollup_state
        WHERE domain = 'report_merchant'
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
        EXISTS (SELECT 1 FROM public.report_dirty_hours LIMIT 1) AS has_dirty
      FROM public.report_rollup_state
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
    if (isMissingRelationError(err)) {
      handleMissingRollupRelation(err, {
        domain: "report_merchant",
        relation: mode === "v2" ? "aggregation_rollup_state" : "report_rollup_state",
        mode,
      });
      return { rollupUntil: null, isFinite: false, hasDirty: false, mode };
    }
    throw err;
  }
}

async function timestampsToSortedVnDays(client, timestamps) {
  if (!Array.isArray(timestamps) || timestamps.length === 0) {
    return [];
  }
  const res = await client.query(
    `
    SELECT ARRAY(
      SELECT DISTINCT ((ts AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::text
      FROM unnest($1::timestamptz[]) AS ts
      ORDER BY 1 ASC
    ) AS vn_days
    `,
    [timestamps]
  );
  return res.rows[0]?.vn_days || [];
}

/**
 * Đối soát độc lập 2 nhóm cột TX và Fee cho bảng report_merchant_financial_daily theo từng ngày VN.
 * Không xóa nguyên hàng khi chỉ 1 phía (TX hoặc Fee) thay đổi; chỉ xóa hàng khi cả 4 chỉ số = 0.
 */
async function reconcileReportDaysV2(client, txDays, feeDays, cutoff) {
  const uniqueTxDays = [...new Set(txDays || [])].sort();
  const uniqueFeeDays = [...new Set(feeDays || [])].sort();

  if (uniqueTxDays.length > 0 && cutoff) {
    await client.query(
      `
      UPDATE public.report_merchant_financial_daily
      SET tx_count = 0, tx_amount = 0, updated_at = NOW()
      WHERE bucket_day = ANY($1::date[])
      `,
      [uniqueTxDays]
    );
    await client.query(
      `
      INSERT INTO public.report_merchant_financial_daily (
        bucket_day, merchant_id, transaction_type, tx_count, tx_amount, updated_at
      )
      SELECT
        (t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_day,
        u.id AS merchant_id,
        t.transaction_type::text AS transaction_type,
        COUNT(*)::bigint AS tx_count,
        COALESCE(SUM(t.amount), 0)::numeric(22, 0) AS tx_amount,
        NOW() AS updated_at
      FROM unnest($1::date[]) AS d(bucket_day)
      JOIN public.transactions t
        ON t.created_at >= (d.bucket_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
       AND t.created_at < ((d.bucket_day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      JOIN public.users u
        ON u.id = t.destination_user_id
       AND u.role = 'MERCHANT'
      WHERE t.created_at < $2
        AND t.status IN ('SUCCESS', 'COMPLETED')
        AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
        AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
      GROUP BY 1, 2, 3
      ON CONFLICT (bucket_day, merchant_id, transaction_type) DO UPDATE SET
        tx_count   = EXCLUDED.tx_count,
        tx_amount  = EXCLUDED.tx_amount,
        updated_at = NOW()
      `,
      [uniqueTxDays, cutoff]
    );
  }

  if (uniqueFeeDays.length > 0 && cutoff) {
    await client.query(
      `
      UPDATE public.report_merchant_financial_daily
      SET fee_amount = 0, fee_tx_count = 0, updated_at = NOW()
      WHERE bucket_day = ANY($1::date[])
      `,
      [uniqueFeeDays]
    );
    await client.query(
      `
      INSERT INTO public.report_merchant_financial_daily (
        bucket_day, merchant_id, transaction_type, fee_amount, fee_tx_count, updated_at
      )
      SELECT
        (l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_day,
        u.id AS merchant_id,
        t.transaction_type::text AS transaction_type,
        COALESCE(SUM(l.amount), 0)::numeric(22, 0) AS fee_amount,
        COUNT(*)::bigint AS fee_tx_count,
        NOW() AS updated_at
      FROM unnest($1::date[]) AS d(bucket_day)
      JOIN public.fee_ledger_entries l
        ON l.created_at >= (d.bucket_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
       AND l.created_at < ((d.bucket_day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      JOIN public.transactions t
        ON t.id = l.transaction_id
      JOIN public.users u
        ON u.id = t.destination_user_id
       AND u.role = 'MERCHANT'
      WHERE l.created_at < $2
        AND l.fee_type = 'QR_FEE'
        AND l.transaction_id IS NOT NULL
        AND t.status IN ('SUCCESS', 'COMPLETED')
        AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
        AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
      GROUP BY 1, 2, 3
      ON CONFLICT (bucket_day, merchant_id, transaction_type) DO UPDATE SET
        fee_amount   = EXCLUDED.fee_amount,
        fee_tx_count = EXCLUDED.fee_tx_count,
        updated_at   = NOW()
      `,
      [uniqueFeeDays, cutoff]
    );
  }

  const allDays = [...new Set([...uniqueTxDays, ...uniqueFeeDays])].sort();
  if (allDays.length > 0) {
    await client.query(
      `
      DELETE FROM public.report_merchant_financial_daily
      WHERE bucket_day = ANY($1::date[])
        AND tx_count = 0
        AND tx_amount = 0
        AND fee_amount = 0
        AND fee_tx_count = 0
      `,
      [allDays]
    );
  }
}

/**
 * Đối soát có chọn lọc từng miền bảng rollup dựa trên cờ dirty:
 * - v1: report_dirty_hours (fee/tx/gateway)
 * - v2: aggregation_dirty_buckets (report_merchant: txDays & feeDays độc lập) + retry 40P01/55P03
 */
async function reconcileReportDirtyHours(db = pool, options = {}) {
  const mode = options.storageMode || getAnalyticsStorageMode();
  if (mode === "raw") {
    return {
      rollupUntil: null,
      reconciledHours: 0,
      reconciledDomains: { fee: 0, tx: 0, gateway: 0 },
      mode,
    };
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
          REPORT_ROLLUP_LOCK_KEY,
        ]);

        if (mode === "v2") {
          await client.query("SET LOCAL lock_timeout = '3s'");
          await client.query("SET LOCAL statement_timeout = '30s'");

          const stateRes = await client.query(`
            SELECT
              rollup_until,
              (rollup_until > '-infinity'::timestamptz AND rollup_until < 'infinity'::timestamptz) AS is_finite
            FROM public.aggregation_rollup_state
            WHERE domain = 'report_merchant'
          `);
          const isFinite = Boolean(stateRes.rows[0]?.is_finite);
          const rollupUntil = isFinite ? stateRes.rows[0].rollup_until : null;

          const poppedRes = await client.query(`
            DELETE FROM public.aggregation_dirty_buckets
            WHERE domain = 'report_merchant'
            RETURNING bucket_ts, dirty_tx, dirty_fee
          `);
          const dirtyRows = poppedRes.rows || [];
          const txBuckets = dirtyRows.filter((r) => r.dirty_tx).map((r) => r.bucket_ts);
          const feeBuckets = dirtyRows.filter((r) => r.dirty_fee).map((r) => r.bucket_ts);

          const txDays = isFinite && rollupUntil ? await timestampsToSortedVnDays(client, txBuckets) : [];
          const feeDays = isFinite && rollupUntil ? await timestampsToSortedVnDays(client, feeBuckets) : [];

          if (isFinite && rollupUntil && (txDays.length > 0 || feeDays.length > 0)) {
            await reconcileReportDaysV2(client, txDays, feeDays, rollupUntil);
          }

          await client.query("COMMIT");
          return {
            rollupUntil,
            reconciledHours: dirtyRows.length,
            reconciledDomains: {
              fee: feeDays.length,
              tx: txDays.length,
              gateway: 0,
            },
            mode,
          };
        }

        const stateRes = await client.query(`
          SELECT
            rollup_until,
            (rollup_until > '-infinity'::timestamptz AND rollup_until < 'infinity'::timestamptz) AS is_finite
          FROM public.report_rollup_state
          WHERE id = 1
        `);
        const isFinite = Boolean(stateRes.rows[0]?.is_finite);
        const rollupUntil = isFinite ? stateRes.rows[0].rollup_until : null;

        const poppedRes = await client.query(`
          DELETE FROM public.report_dirty_hours
          RETURNING bucket_hour, dirty_fee, dirty_tx, dirty_gateway
        `);
        const dirtyRows = poppedRes.rows || [];

        const feeHours = [];
        const txHours = [];
        const gatewayHours = [];
        for (const r of dirtyRows) {
          if (r.dirty_fee) feeHours.push(r.bucket_hour);
          if (r.dirty_tx) txHours.push(r.bucket_hour);
          if (r.dirty_gateway) gatewayHours.push(r.bucket_hour);
        }

        if (feeHours.length > 0) {
          await client.query(
            `DELETE FROM public.report_merchant_fee_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
            [feeHours]
          );
          if (isFinite && rollupUntil) {
            await client.query(
              `
              INSERT INTO public.report_merchant_fee_hourly (
                bucket_hour, merchant_id, transaction_type, fee_amount, fee_tx_count, updated_at
              )
              SELECT
                date_trunc('hour', l.created_at) AS bucket_hour,
                u.id AS merchant_id,
                t.transaction_type::text AS transaction_type,
                COALESCE(SUM(l.amount), 0)::numeric(22, 0) AS fee_amount,
                COUNT(*)::bigint AS fee_tx_count,
                NOW() AS updated_at
              FROM unnest($1::timestamptz[]) AS d(bucket_hour)
              JOIN public.fee_ledger_entries l
                ON l.created_at >= d.bucket_hour
               AND l.created_at < d.bucket_hour + INTERVAL '1 hour'
              JOIN public.transactions t ON t.id = l.transaction_id
              JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
              WHERE d.bucket_hour < $2
                AND l.created_at < $2
                AND l.fee_type = 'QR_FEE'
                AND t.status IN ('SUCCESS', 'COMPLETED')
                AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
                AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
              GROUP BY 1, 2, 3
              ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
                fee_amount = EXCLUDED.fee_amount,
                fee_tx_count = EXCLUDED.fee_tx_count,
                updated_at = NOW()
              `,
              [feeHours, rollupUntil]
            );
          }
        }

        if (txHours.length > 0) {
          await client.query(
            `DELETE FROM public.report_merchant_tx_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
            [txHours]
          );
          if (isFinite && rollupUntil) {
            await client.query(
              `
              INSERT INTO public.report_merchant_tx_hourly (
                bucket_hour, merchant_id, transaction_type, tx_count, tx_amount, merchant_fee_total, updated_at
              )
              SELECT
                date_trunc('hour', t.created_at) AS bucket_hour,
                u.id AS merchant_id,
                t.transaction_type::text AS transaction_type,
                COUNT(*)::bigint AS tx_count,
                COALESCE(SUM(t.amount), 0)::numeric(22, 0) AS tx_amount,
                COALESCE(SUM(COALESCE(t.merchant_fee, 0)), 0)::numeric(22, 0) AS merchant_fee_total,
                NOW() AS updated_at
              FROM unnest($1::timestamptz[]) AS d(bucket_hour)
              JOIN public.transactions t
                ON t.created_at >= d.bucket_hour
               AND t.created_at < d.bucket_hour + INTERVAL '1 hour'
              JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
              WHERE d.bucket_hour < $2
                AND t.created_at < $2
                AND t.status IN ('SUCCESS', 'COMPLETED')
                AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
                AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
              GROUP BY 1, 2, 3
              ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
                tx_count = EXCLUDED.tx_count,
                tx_amount = EXCLUDED.tx_amount,
                merchant_fee_total = EXCLUDED.merchant_fee_total,
                updated_at = NOW()
              `,
              [txHours, rollupUntil]
            );
          }
        }

        if (gatewayHours.length > 0) {
          await client.query(
            `DELETE FROM public.report_gateway_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
            [gatewayHours]
          );
          if (isFinite && rollupUntil) {
            await client.query(
              `
              INSERT INTO public.report_gateway_hourly (
                bucket_hour, merchant_id, has_order_id,
                total_requests, success_count, pending_count, expired_count, failed_count, cancelled_count, updated_at
              )
              SELECT
                date_trunc('hour', pr.created_at) AS bucket_hour,
                u.id AS merchant_id,
                (pr.order_id IS NOT NULL) AS has_order_id,
                COUNT(*)::bigint AS total_requests,
                COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS', 'PAID'))::bigint AS success_count,
                COUNT(*) FILTER (WHERE pr.status = 'PENDING')::bigint AS pending_count,
                COUNT(*) FILTER (WHERE pr.status = 'EXPIRED')::bigint AS expired_count,
                COUNT(*) FILTER (WHERE pr.status = 'FAILED')::bigint AS failed_count,
                COUNT(*) FILTER (WHERE pr.status = 'CANCELLED')::bigint AS cancelled_count,
                NOW() AS updated_at
              FROM unnest($1::timestamptz[]) AS d(bucket_hour)
              JOIN public.payment_requests pr
                ON pr.created_at >= d.bucket_hour
               AND pr.created_at < d.bucket_hour + INTERVAL '1 hour'
              JOIN public.users u ON u.id = pr.destination_user_id AND u.role = 'MERCHANT'
              WHERE d.bucket_hour < $2
                AND pr.created_at IS NOT NULL
                AND pr.created_at < $2
              GROUP BY 1, 2, 3
              ON CONFLICT (bucket_hour, merchant_id, has_order_id) DO UPDATE SET
                total_requests = EXCLUDED.total_requests,
                success_count = EXCLUDED.success_count,
                pending_count = EXCLUDED.pending_count,
                expired_count = EXCLUDED.expired_count,
                failed_count = EXCLUDED.failed_count,
                cancelled_count = EXCLUDED.cancelled_count,
                updated_at = NOW()
              `,
              [gatewayHours, rollupUntil]
            );
          }
        }

        await client.query("COMMIT");
        return {
          rollupUntil,
          reconciledHours: dirtyRows.length,
          reconciledDomains: {
            fee: feeHours.length,
            tx: txHours.length,
            gateway: gatewayHours.length,
          },
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

async function ensureReportRollupConsistent(db = pool, options = {}) {
  const mode = options.storageMode || getAnalyticsStorageMode();
  if (mode === "raw") {
    return null;
  }
  const state = await getReportRollupState(db, { storageMode: mode });
  if (!state.hasDirty) {
    return state.rollupUntil;
  }
  try {
    const result = await reconcileReportDirtyHours(db, { storageMode: mode });
    return result.rollupUntil;
  } catch (err) {
    if (isMissingRelationError(err)) {
      handleMissingRollupRelation(err, {
        domain: "report_merchant",
        relation: mode === "v2" ? "aggregation_dirty_buckets" : "report_dirty_hours",
        mode,
      });
      return null;
    }
    throw err;
  }
}

/**
 * Cuộn mốc rollup_until cho domain = 'report_merchant':
 * - v1: report_rollup_state về 00:00 hôm nay theo Asia/Ho_Chi_Minh.
 * - v2: aggregation_rollup_state về 00:00:00+07:00 VN an toàn (lùi 1 phút tránh ranh giới nửa đêm) bằng Watermark Barrier.
 */
async function advanceReportRollupCutoff(db = pool, options = {}) {
  const mode = options.storageMode || getAnalyticsStorageMode();
  if (mode === "raw") {
    return { rollupUntil: null, rolledUpRows: 0, skippedRawMode: true };
  }

  let reconcileResult;
  try {
    reconcileResult = await reconcileReportDirtyHours(db, { storageMode: mode });
  } catch (err) {
    if (isMissingRelationError(err)) {
      handleMissingRollupRelation(err, {
        domain: "report_merchant",
        relation: mode === "v2" ? "aggregation_dirty_buckets" : "report_dirty_hours",
        mode,
      });
      return { rollupUntil: null, rolledUpRows: 0, skippedMissingSchema: true };
    }
    throw err;
  }

  if (reconcileResult.skippedMissingSchema) {
    return { rollupUntil: null, rolledUpRows: 0, skippedMissingSchema: true };
  }

  if (mode === "v2") {
    let totalRolledDays = 0;
    let latestRollupUntil = null;

    while (true) {
      const guardPrep = await retryOnLockConflict(async () => {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock($1)", [
            REPORT_ROLLUP_LOCK_KEY,
          ]);
          await client.query("SET LOCAL lock_timeout = '3s'");

          const checkRes = await client.query(`
            SELECT
              s.rollup_until,
              (s.rollup_until > '-infinity'::timestamptz AND s.rollup_until < 'infinity'::timestamptz) AS is_finite,
              (DATE_TRUNC('day', (NOW() - INTERVAL '1 minute') AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS target_cutoff,
              LEAST(
                s.rollup_until + INTERVAL '7 days',
                (DATE_TRUNC('day', (NOW() - INTERVAL '1 minute') AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')
              ) AS next_cutoff
            FROM public.aggregation_rollup_state s
            WHERE s.domain = 'report_merchant'
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
            WHERE domain = 'report_merchant'
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
          if (isMissingRelationError(err)) {
            handleMissingRollupRelation(err, {
              domain: "report_merchant",
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
            `UPDATE public.aggregation_rollup_state SET dirty_guard_until = NULL, updated_at = NOW() WHERE domain = 'report_merchant'`
          )
          .catch(() => {});
        return {
          rollupUntil: guardPrep.currentUntil,
          rolledUpRows: totalRolledDays,
          deferredXidDrain: true,
        };
      }

      const daysApplied = await retryOnLockConflict(async () => {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock($1)", [
            REPORT_ROLLUP_LOCK_KEY,
          ]);
          await client.query("SET LOCAL lock_timeout = '3s'");
          await client.query("SET LOCAL statement_timeout = '30s'");
          await client.query("SET LOCAL work_mem = '64MB'");

          const chunkDaysRes = await client.query(
            `
            SELECT ARRAY(
              SELECT to_char(gs::date, 'YYYY-MM-DD')
              FROM generate_series(
                ($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                (($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                interval '1 day'
              ) AS gs
              ORDER BY 1 ASC
            ) AS vn_days
            `,
            [guardPrep.currentUntil, guardPrep.nextCutoff]
          );
          const chunkDays = chunkDaysRes.rows[0]?.vn_days || [];

          const poppedDirty = await client.query(
            `
            DELETE FROM public.aggregation_dirty_buckets
            WHERE domain = 'report_merchant' AND bucket_ts < $1
            RETURNING bucket_ts, dirty_tx, dirty_fee
            `,
            [guardPrep.nextCutoff]
          );
          const extraTxDays = await timestampsToSortedVnDays(
            client,
            poppedDirty.rows.filter((r) => r.dirty_tx).map((r) => r.bucket_ts)
          );
          const extraFeeDays = await timestampsToSortedVnDays(
            client,
            poppedDirty.rows.filter((r) => r.dirty_fee).map((r) => r.bucket_ts)
          );

          await reconcileReportDaysV2(
            client,
            [...chunkDays, ...extraTxDays],
            [...chunkDays, ...extraFeeDays],
            guardPrep.nextCutoff
          );

          await client.query(
            `
            UPDATE public.aggregation_rollup_state
            SET rollup_until = $1, dirty_guard_until = NULL, updated_at = NOW()
            WHERE domain = 'report_merchant'
            `,
            [guardPrep.nextCutoff]
          );

          await client.query("COMMIT");
          return chunkDays.length;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });

      totalRolledDays += daysApplied;
      latestRollupUntil = guardPrep.nextCutoff;
      if (guardPrep.nextCutoff.getTime() >= guardPrep.targetCutoff.getTime()) {
        break;
      }
    }

    return {
      rollupUntil: latestRollupUntil,
      rolledUpRows: totalRolledDays,
      mode,
    };
  }

  // v1 legacy progression
  const client = await db.connect();
  try {
    let totalRolledRows = 0;
    let latestRollupUntil = null;

    while (true) {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        REPORT_ROLLUP_LOCK_KEY,
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
        FROM public.report_rollup_state s
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
        `DELETE FROM public.report_merchant_fee_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
        [currentUntil, nextCutoff]
      );
      const feeIns = await client.query(
        `
        INSERT INTO public.report_merchant_fee_hourly (
          bucket_hour, merchant_id, transaction_type, fee_amount, fee_tx_count, updated_at
        )
        SELECT
          date_trunc('hour', l.created_at) AS bucket_hour,
          u.id AS merchant_id,
          t.transaction_type::text AS transaction_type,
          COALESCE(SUM(l.amount), 0)::numeric(22, 0) AS fee_amount,
          COUNT(*)::bigint AS fee_tx_count,
          NOW() AS updated_at
        FROM public.fee_ledger_entries l
        JOIN public.transactions t ON t.id = l.transaction_id
        JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
        WHERE l.fee_type = 'QR_FEE'
          AND t.status IN ('SUCCESS', 'COMPLETED')
          AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
          AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
          AND l.created_at >= $1
          AND l.created_at < $2
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
          fee_amount = EXCLUDED.fee_amount,
          fee_tx_count = EXCLUDED.fee_tx_count,
          updated_at = NOW()
        `,
        [currentUntil, nextCutoff]
      );

      await client.query(
        `DELETE FROM public.report_merchant_tx_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
        [currentUntil, nextCutoff]
      );
      const txIns = await client.query(
        `
        INSERT INTO public.report_merchant_tx_hourly (
          bucket_hour, merchant_id, transaction_type, tx_count, tx_amount, merchant_fee_total, updated_at
        )
        SELECT
          date_trunc('hour', t.created_at) AS bucket_hour,
          u.id AS merchant_id,
          t.transaction_type::text AS transaction_type,
          COUNT(*)::bigint AS tx_count,
          COALESCE(SUM(t.amount), 0)::numeric(22, 0) AS tx_amount,
          COALESCE(SUM(COALESCE(t.merchant_fee, 0)), 0)::numeric(22, 0) AS merchant_fee_total,
          NOW() AS updated_at
        FROM public.transactions t
        JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
        WHERE t.status IN ('SUCCESS', 'COMPLETED')
          AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
          AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
          AND t.created_at >= $1
          AND t.created_at < $2
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
          tx_count = EXCLUDED.tx_count,
          tx_amount = EXCLUDED.tx_amount,
          merchant_fee_total = EXCLUDED.merchant_fee_total,
          updated_at = NOW()
        `,
        [currentUntil, nextCutoff]
      );

      await client.query(
        `DELETE FROM public.report_gateway_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
        [currentUntil, nextCutoff]
      );
      const gwIns = await client.query(
        `
        INSERT INTO public.report_gateway_hourly (
          bucket_hour, merchant_id, has_order_id,
          total_requests, success_count, pending_count, expired_count, failed_count, cancelled_count, updated_at
        )
        SELECT
          date_trunc('hour', pr.created_at) AS bucket_hour,
          u.id AS merchant_id,
          (pr.order_id IS NOT NULL) AS has_order_id,
          COUNT(*)::bigint AS total_requests,
          COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS', 'PAID'))::bigint AS success_count,
          COUNT(*) FILTER (WHERE pr.status = 'PENDING')::bigint AS pending_count,
          COUNT(*) FILTER (WHERE pr.status = 'EXPIRED')::bigint AS expired_count,
          COUNT(*) FILTER (WHERE pr.status = 'FAILED')::bigint AS failed_count,
          COUNT(*) FILTER (WHERE pr.status = 'CANCELLED')::bigint AS cancelled_count,
          NOW() AS updated_at
        FROM public.payment_requests pr
        JOIN public.users u ON u.id = pr.destination_user_id AND u.role = 'MERCHANT'
        WHERE pr.created_at IS NOT NULL
          AND pr.created_at >= $1
          AND pr.created_at < $2
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, merchant_id, has_order_id) DO UPDATE SET
          total_requests = EXCLUDED.total_requests,
          success_count = EXCLUDED.success_count,
          pending_count = EXCLUDED.pending_count,
          expired_count = EXCLUDED.expired_count,
          failed_count = EXCLUDED.failed_count,
          cancelled_count = EXCLUDED.cancelled_count,
          updated_at = NOW()
        `,
        [currentUntil, nextCutoff]
      );

      await client.query(
        `DELETE FROM public.report_dirty_hours WHERE bucket_hour >= $1 AND bucket_hour < $2`,
        [currentUntil, nextCutoff]
      );

      await client.query(
        `UPDATE public.report_rollup_state SET rollup_until = $1, updated_at = NOW() WHERE id = 1`,
        [nextCutoff]
      );

      await client.query("COMMIT");
      totalRolledRows +=
        (feeIns.rowCount || 0) + (txIns.rowCount || 0) + (gwIns.rowCount || 0);
      latestRollupUntil = nextCutoff;

      if (nextCutoff.getTime() >= new Date(row.target_cutoff).getTime()) {
        break;
      }
    }

    return {
      rollupUntil: latestRollupUntil,
      rolledUpRows: totalRolledRows,
      mode,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (isMissingRelationError(err)) {
      handleMissingRollupRelation(err, {
        domain: "report_merchant",
        relation: "report_rollup_state",
        mode,
      });
      return { rollupUntil: null, rolledUpRows: 0, skippedMissingSchema: true };
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------- V1 Query Builders ----------

function buildV1FeeEventCtes(addParam, filters, hybrid) {
  const branches = [];

  if (hybrid.useRollup) {
    const s = addParam(filters.startInstant);
    const e = addParam(hybrid.splitInstant);
    const conds = [`bucket_hour >= ${s}`, `bucket_hour < ${e}`];
    if (filters.merchant) {
      conds.push(`merchant_id = ${addParam(filters.merchant)}::uuid`);
    }
    if (filters.type) {
      conds.push(`transaction_type = ${addParam(filters.type)}`);
    } else {
      conds.push(`transaction_type IN ('PAYMENT', 'TRANSFER')`);
    }
    branches.push(`
      SELECT
        bucket_hour,
        merchant_id,
        transaction_type AS type,
        fee_amount::numeric AS revenue
      FROM public.report_merchant_fee_hourly
      WHERE ${conds.join(" AND ")}
    `);
  }

  if (hybrid.useTail) {
    const s = addParam(hybrid.splitInstant);
    const e = addParam(filters.nextDayInstant);
    const conds = [
      `l.fee_type = 'QR_FEE'`,
      `t.status IN ('SUCCESS', 'COMPLETED')`,
      `COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'`,
      filters.type
        ? `t.transaction_type = ${addParam(filters.type)}`
        : `t.transaction_type IN ('PAYMENT', 'TRANSFER')`,
      `l.created_at >= ${s}`,
      `l.created_at < ${e}`,
    ];
    if (filters.merchant) {
      conds.push(`t.destination_user_id = ${addParam(filters.merchant)}::uuid`);
    }
    branches.push(`
      SELECT
        l.created_at AS bucket_hour,
        u.id AS merchant_id,
        t.transaction_type::text AS type,
        l.amount::numeric AS revenue
      FROM public.fee_ledger_entries l
      JOIN public.transactions t ON t.id = l.transaction_id
      JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
      WHERE ${conds.join(" AND ")}
    `);
  }

  return branches.join("\n      UNION ALL\n");
}

function buildV1TxEventCtes(addParam, filters, hybrid) {
  const branches = [];

  if (hybrid.useRollup) {
    const s = addParam(filters.startInstant);
    const e = addParam(hybrid.splitInstant);
    const conds = [`bucket_hour >= ${s}`, `bucket_hour < ${e}`];
    if (filters.merchant) {
      conds.push(`merchant_id = ${addParam(filters.merchant)}::uuid`);
    }
    if (filters.type) {
      conds.push(`transaction_type = ${addParam(filters.type)}`);
    } else {
      conds.push(`transaction_type IN ('PAYMENT', 'TRANSFER')`);
    }
    branches.push(`
      SELECT
        bucket_hour,
        merchant_id,
        transaction_type AS type,
        tx_amount::numeric AS gross,
        tx_count::bigint AS tx_count
      FROM public.report_merchant_tx_hourly
      WHERE ${conds.join(" AND ")}
    `);
  }

  if (hybrid.useTail) {
    const s = addParam(hybrid.splitInstant);
    const e = addParam(filters.nextDayInstant);
    const conds = [
      `t.status IN ('SUCCESS', 'COMPLETED')`,
      `COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'`,
      filters.type
        ? `t.transaction_type = ${addParam(filters.type)}`
        : `t.transaction_type IN ('PAYMENT', 'TRANSFER')`,
      `t.created_at >= ${s}`,
      `t.created_at < ${e}`,
    ];
    if (filters.merchant) {
      conds.push(`t.destination_user_id = ${addParam(filters.merchant)}::uuid`);
    }
    branches.push(`
      SELECT
        t.created_at AS bucket_hour,
        u.id AS merchant_id,
        t.transaction_type::text AS type,
        t.amount::numeric AS gross,
        1::bigint AS tx_count
      FROM public.transactions t
      JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
      WHERE ${conds.join(" AND ")}
    `);
  }

  return branches.join("\n      UNION ALL\n");
}

function buildV1GatewaySql(addParam, filters, hybrid) {
  const branches = [];

  if (hybrid.useRollup) {
    const s = addParam(filters.startInstant);
    const e = addParam(hybrid.splitInstant);
    const conds = [
      `has_order_id = true`,
      `bucket_hour >= ${s}`,
      `bucket_hour < ${e}`,
    ];
    if (filters.merchant) {
      conds.push(`merchant_id = ${addParam(filters.merchant)}::uuid`);
    }
    branches.push(`
      SELECT
        COALESCE(SUM(total_requests), 0)::bigint AS total,
        COALESCE(SUM(success_count), 0)::bigint AS success,
        COALESCE(SUM(pending_count), 0)::bigint AS pending,
        COALESCE(SUM(expired_count), 0)::bigint AS expired,
        COALESCE(SUM(failed_count), 0)::bigint AS failed,
        COALESCE(SUM(cancelled_count), 0)::bigint AS cancelled
      FROM public.report_gateway_hourly
      WHERE ${conds.join(" AND ")}
    `);
  }

  if (hybrid.useTail) {
    const s = addParam(hybrid.splitInstant);
    const e = addParam(filters.nextDayInstant);
    const conds = [
      `pr.order_id IS NOT NULL`,
      `pr.created_at >= ${s}`,
      `pr.created_at < ${e}`,
    ];
    if (filters.merchant) {
      conds.push(`u.id = ${addParam(filters.merchant)}::uuid`);
    }
    branches.push(`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS', 'PAID'))::bigint AS success,
        COUNT(*) FILTER (WHERE pr.status = 'PENDING')::bigint AS pending,
        COUNT(*) FILTER (WHERE pr.status = 'EXPIRED')::bigint AS expired,
        COUNT(*) FILTER (WHERE pr.status = 'FAILED')::bigint AS failed,
        COUNT(*) FILTER (WHERE pr.status = 'CANCELLED')::bigint AS cancelled
      FROM public.payment_requests pr
      JOIN public.users u ON u.id = pr.destination_user_id AND u.role = 'MERCHANT'
      WHERE ${conds.join(" AND ")}
    `);
  }

  return branches.join("\n      UNION ALL\n");
}

// ---------- V2 Helpers (Using Exact Gate 4 Benchmarked Q7 & Q5 SQL) ----------

function buildV2DailyWhere(addParam, filters, startInstant, endInstant) {
  const s = addParam(startInstant);
  const e = addParam(endInstant);
  const conds = [
    `bucket_day >= (${s}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
    `bucket_day < (${e}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
  ];
  if (filters.merchant) {
    conds.push(`merchant_id = ${addParam(filters.merchant)}::uuid`);
  }
  if (filters.type) {
    conds.push(`transaction_type = ${addParam(filters.type)}`);
  } else {
    conds.push(`transaction_type IN ('PAYMENT', 'TRANSFER')`);
  }
  return conds.join(" AND ");
}

function buildTailFeeConds(addParam, filters, splitInstant, nextDayInstant) {
  const s = addParam(splitInstant);
  const e = addParam(nextDayInstant);
  const conds = [
    `l.fee_type = 'QR_FEE'`,
    `l.transaction_id IS NOT NULL`,
    `t.status IN ('SUCCESS', 'COMPLETED')`,
    `COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'`,
    filters.type
      ? `t.transaction_type = ${addParam(filters.type)}`
      : `t.transaction_type IN ('PAYMENT', 'TRANSFER')`,
    `l.created_at >= ${s}`,
    `l.created_at < ${e}`,
  ];
  if (filters.merchant) {
    conds.push(`t.destination_user_id = ${addParam(filters.merchant)}::uuid`);
  }
  return conds.join(" AND ");
}

function buildTailTxConds(addParam, filters, splitInstant, nextDayInstant) {
  const s = addParam(splitInstant);
  const e = addParam(nextDayInstant);
  const conds = [
    `t.status IN ('SUCCESS', 'COMPLETED')`,
    `COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'`,
    filters.type
      ? `t.transaction_type = ${addParam(filters.type)}`
      : `t.transaction_type IN ('PAYMENT', 'TRANSFER')`,
    `t.created_at >= ${s}`,
    `t.created_at < ${e}`,
  ];
  if (filters.merchant) {
    conds.push(`t.destination_user_id = ${addParam(filters.merchant)}::uuid`);
  }
  return conds.join(" AND ");
}

/**
 * Exact Gate 4 benchmarked Q5 Gateway SQL:
 * Pre-aggregates payment_requests by destination_user_id before joining users(MERCHANT).
 */
function buildV2GatewayDirectSql(addParam, filters) {
  const gwConds = [
    `pr.order_id IS NOT NULL`,
    `pr.created_at >= ${addParam(filters.startInstant)}`,
    `pr.created_at < ${addParam(filters.nextDayInstant)}`,
  ];
  if (filters.merchant) {
    gwConds.push(`pr.destination_user_id = ${addParam(filters.merchant)}::uuid`);
  }
  return `
    SELECT
      COALESCE(SUM(t.total), 0)::bigint AS total,
      COALESCE(SUM(t.success), 0)::bigint AS success,
      COALESCE(SUM(t.pending), 0)::bigint AS pending,
      COALESCE(SUM(t.expired), 0)::bigint AS expired,
      COALESCE(SUM(t.failed), 0)::bigint AS failed,
      COALESCE(SUM(t.cancelled), 0)::bigint AS cancelled
    FROM (
      SELECT
        pr.destination_user_id,
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE pr.status IN ('SUCCESS', 'PAID'))::bigint AS success,
        COUNT(*) FILTER (WHERE pr.status = 'PENDING')::bigint AS pending,
        COUNT(*) FILTER (WHERE pr.status = 'EXPIRED')::bigint AS expired,
        COUNT(*) FILTER (WHERE pr.status = 'FAILED')::bigint AS failed,
        COUNT(*) FILTER (WHERE pr.status = 'CANCELLED')::bigint AS cancelled
      FROM public.payment_requests pr
      WHERE ${gwConds.join(" AND ")}
      GROUP BY pr.destination_user_id
    ) t
    JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
  `;
}

/**
 * Truy vấn nhanh chỉ KPI Doanh thu phí Merchant (scope=kpi).
 */
async function queryFeeRevenueSummary(db, filters, rollupUntil, options = {}) {
  const mode = options.storageMode || getAnalyticsStorageMode();
  const effectiveUntil = mode === "raw" ? null : rollupUntil;
  const hybrid = computeHybridWindow(
    filters.startInstant,
    filters.nextDayInstant,
    effectiveUntil
  );
  const params = [];
  const addParam = makeParamAdder(params);

  if (mode === "v2") {
    const branches = [];
    if (hybrid.useRollup) {
      const dailyWhere = buildV2DailyWhere(
        addParam,
        filters,
        filters.startInstant,
        hybrid.splitInstant
      );
      branches.push(`
        SELECT COALESCE(SUM(fee_amount), 0)::bigint AS revenue
        FROM public.report_merchant_financial_daily
        WHERE ${dailyWhere}
      `);
    }
    if (hybrid.useTail) {
      const tailWhere = buildTailFeeConds(
        addParam,
        filters,
        hybrid.splitInstant,
        filters.nextDayInstant
      );
      branches.push(`
        SELECT COALESCE(SUM(l.amount), 0)::bigint AS revenue
        FROM public.fee_ledger_entries l
        JOIN public.transactions t ON t.id = l.transaction_id
        JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
        WHERE ${tailWhere}
      `);
    }
    if (branches.length === 0) return 0;
    const sql =
      branches.length === 1
        ? branches[0]
        : `SELECT COALESCE(SUM(revenue), 0)::bigint AS revenue FROM (${branches.join("\n UNION ALL \n")}) f`;
    const { rows } = await db.query(sql, params);
    return Number(rows[0]?.revenue || 0);
  }

  const feeUnion = buildV1FeeEventCtes(addParam, filters, hybrid);
  if (!feeUnion) {
    return 0;
  }

  const sql = `
    SELECT COALESCE(SUM(revenue), 0)::bigint AS revenue
    FROM (
      ${feeUnion}
    ) fee_events
  `;
  const { rows } = await db.query(sql, params);
  return Number(rows[0]?.revenue || 0);
}

/**
 * Truy vấn chỉ khối phân trang bảng hiệu suất Merchant (scope=merchants).
 */
async function queryMerchantsPage(
  db,
  filters,
  rollupUntil,
  { allMerchants = false, storageMode = null } = {}
) {
  const mode = storageMode || getAnalyticsStorageMode();
  const effectiveUntil = mode === "raw" ? null : rollupUntil;
  const hybrid = computeHybridWindow(
    filters.startInstant,
    filters.nextDayInstant,
    effectiveUntil
  );
  const params = [];
  const addParam = makeParamAdder(params);

  if (mode === "v2") {
    const limitParam = addParam(allMerchants ? null : filters.limit);
    const offsetParam = addParam(allMerchants ? 0 : (filters.page - 1) * filters.limit);

    let merchantTotalsSql;
    if (hybrid.useRollup && !hybrid.useTail) {
      const dailyWhere = buildV2DailyWhere(
        addParam,
        filters,
        filters.startInstant,
        hybrid.splitInstant
      );
      merchantTotalsSql = `
        SELECT merchant_id,
               SUM(fee_amount)::bigint AS revenue,
               SUM(tx_amount)::bigint AS gross,
               SUM(tx_count)::bigint AS transactions
        FROM public.report_merchant_financial_daily
        WHERE ${dailyWhere}
        GROUP BY merchant_id
      `;
    } else {
      const parts = [];
      if (hybrid.useRollup) {
        const dailyWhere = buildV2DailyWhere(
          addParam,
          filters,
          filters.startInstant,
          hybrid.splitInstant
        );
        parts.push(`
          SELECT merchant_id,
                 SUM(fee_amount)::bigint AS revenue,
                 SUM(tx_amount)::bigint AS gross,
                 SUM(tx_count)::bigint AS transactions
          FROM public.report_merchant_financial_daily
          WHERE ${dailyWhere}
          GROUP BY merchant_id
        `);
      }
      if (hybrid.useTail) {
        const tailFeeWhere = buildTailFeeConds(
          addParam,
          filters,
          hybrid.splitInstant,
          filters.nextDayInstant
        );
        const tailTxWhere = buildTailTxConds(
          addParam,
          filters,
          hybrid.splitInstant,
          filters.nextDayInstant
        );
        parts.push(`
          SELECT u.id AS merchant_id, COALESCE(SUM(l.amount), 0)::bigint AS revenue, 0::bigint AS gross, 0::bigint AS transactions
          FROM public.fee_ledger_entries l
          JOIN public.transactions t ON t.id = l.transaction_id
          JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
          WHERE ${tailFeeWhere}
          GROUP BY u.id
        `);
        parts.push(`
          SELECT u.id AS merchant_id, 0::bigint AS revenue, COALESCE(SUM(t.amount), 0)::bigint AS gross, COUNT(*)::bigint AS transactions
          FROM public.transactions t
          JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
          WHERE ${tailTxWhere}
          GROUP BY u.id
        `);
      }
      if (parts.length === 0) {
        return { merchants: [], total_merchants: 0 };
      }
      merchantTotalsSql = `
        SELECT merchant_id,
               SUM(revenue)::bigint AS revenue,
               SUM(gross)::bigint AS gross,
               SUM(transactions)::bigint AS transactions
        FROM (${parts.join("\n UNION ALL \n")}) mp
        GROUP BY merchant_id
      `;
    }

    const sql = `
      WITH combined AS (${merchantTotalsSql}),
      paged AS (
        SELECT *, COUNT(*) OVER()::int AS total_merchants
        FROM combined
        ORDER BY revenue DESC, merchant_id
        LIMIT ${limitParam} OFFSET ${offsetParam}
      )
      SELECT p.merchant_id, u.full_name AS merchant_name,
             p.revenue, p.gross, p.transactions, p.total_merchants
      FROM paged p
      JOIN public.users u ON u.id = p.merchant_id
      ORDER BY p.revenue DESC, p.merchant_id
    `;
    const { rows } = await db.query(sql, params);
    if (rows.length === 0) {
      if (!allMerchants && filters.page > 1) {
        const cParams = [];
        const cAdd = makeParamAdder(cParams);
        const cSql = buildV2MerchantCountSql(cAdd, filters, hybrid);
        if (!cSql) return { merchants: [], total_merchants: 0 };
        const cRes = await db.query(cSql, cParams);
        return {
          merchants: [],
          total_merchants: Number(cRes.rows[0]?.total_merchants || 0),
        };
      }
      return { merchants: [], total_merchants: 0 };
    }
    return {
      merchants: rows.map((r) => ({
        merchant_id: r.merchant_id,
        merchant_name: r.merchant_name,
        revenue: Number(r.revenue || 0),
        gross: Number(r.gross || 0),
        transactions: Number(r.transactions || 0),
      })),
      total_merchants: Number(rows[0].total_merchants || 0),
    };
  }

  const feeUnion = buildV1FeeEventCtes(addParam, filters, hybrid);
  const txUnion = buildV1TxEventCtes(addParam, filters, hybrid);
  if (!feeUnion && !txUnion) {
    return { merchants: [], total_merchants: 0 };
  }

  const limitParam = addParam(allMerchants ? null : filters.limit);
  const offsetParam = addParam(allMerchants ? 0 : (filters.page - 1) * filters.limit);

  const sql = `
    WITH fee_agg AS (
      SELECT merchant_id, COALESCE(SUM(revenue), 0)::bigint AS revenue
      FROM (${feeUnion || "SELECT NULL::uuid AS merchant_id, 0::numeric AS revenue WHERE false"}) f
      GROUP BY merchant_id
    ),
    tx_agg AS (
      SELECT merchant_id, COALESCE(SUM(gross), 0)::bigint AS gross, COALESCE(SUM(tx_count), 0)::bigint AS transactions
      FROM (${txUnion || "SELECT NULL::uuid AS merchant_id, 0::numeric AS gross, 0::bigint AS tx_count WHERE false"}) tx
      GROUP BY merchant_id
    ),
    combined AS (
      SELECT
        COALESCE(f.merchant_id, t.merchant_id) AS merchant_id,
        COALESCE(f.revenue, 0)::bigint AS revenue,
        COALESCE(t.gross, 0)::bigint AS gross,
        COALESCE(t.transactions, 0)::bigint AS transactions
      FROM fee_agg f
      FULL OUTER JOIN tx_agg t ON f.merchant_id = t.merchant_id
    ),
    paged AS (
      SELECT *, COUNT(*) OVER()::int AS total_merchants
      FROM combined
      ORDER BY revenue DESC, merchant_id
      LIMIT ${limitParam} OFFSET ${offsetParam}
    )
    SELECT
      p.merchant_id,
      u.full_name AS merchant_name,
      p.revenue,
      p.gross,
      p.transactions,
      p.total_merchants
    FROM paged p
    JOIN public.users u ON u.id = p.merchant_id
    ORDER BY p.revenue DESC, p.merchant_id
  `;

  const { rows } = await db.query(sql, params);
  if (rows.length === 0) {
    if (!allMerchants && filters.page > 1) {
      const countParams = [];
      const addCountParam = makeParamAdder(countParams);
      const feeCountUnion = buildV1FeeEventCtes(addCountParam, filters, hybrid);
      const txCountUnion = buildV1TxEventCtes(addCountParam, filters, hybrid);
      const countRes = await db.query(
        `
        WITH ids AS (
          SELECT merchant_id FROM (${feeCountUnion}) f GROUP BY merchant_id
          UNION
          SELECT merchant_id FROM (${txCountUnion}) tx GROUP BY merchant_id
        )
        SELECT COUNT(*)::int AS total_merchants FROM ids
        `,
        countParams
      );
      return {
        merchants: [],
        total_merchants: Number(countRes.rows[0]?.total_merchants || 0),
      };
    }
    return { merchants: [], total_merchants: 0 };
  }

  const totalMerchants = Number(rows[0].total_merchants || 0);
  const merchants = rows.map((r) => ({
    merchant_id: r.merchant_id,
    merchant_name: r.merchant_name,
    revenue: Number(r.revenue || 0),
    gross: Number(r.gross || 0),
    transactions: Number(r.transactions || 0),
  }));

  return { merchants, total_merchants: totalMerchants };
}

function buildV2MerchantCountSql(addParam, filters, hybrid) {
  const parts = [];
  if (hybrid.useRollup) {
    const dailyWhere = buildV2DailyWhere(
      addParam,
      filters,
      filters.startInstant,
      hybrid.splitInstant
    );
    parts.push(`SELECT DISTINCT merchant_id FROM public.report_merchant_financial_daily WHERE ${dailyWhere}`);
  }
  if (hybrid.useTail) {
    const fWhere = buildTailFeeConds(addParam, filters, hybrid.splitInstant, filters.nextDayInstant);
    const tWhere = buildTailTxConds(addParam, filters, hybrid.splitInstant, filters.nextDayInstant);
    parts.push(`
      SELECT DISTINCT u.id AS merchant_id
      FROM public.fee_ledger_entries l
      JOIN public.transactions t ON t.id = l.transaction_id
      JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
      WHERE ${fWhere}
    `);
    parts.push(`
      SELECT DISTINCT u.id AS merchant_id
      FROM public.transactions t
      JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
      WHERE ${tWhere}
    `);
  }
  if (parts.length === 0) return null;
  return `SELECT COUNT(*)::int AS total_merchants FROM (${parts.join("\n UNION \n")}) ids`;
}

/**
 * Truy vấn đầy đủ báo cáo (Q7 + Q5):
 * - mode === 'v2' (hoặc 'raw' với Gateway): dùng ĐÚNG mẫu SQL Q7 (`bucket_type_agg` + direct `merchant_totals`)
 *   và Q5 (`GROUP BY destination_user_id` trước khi `JOIN users`) đã đạt benchmark Cổng 4 (0 temp spill).
 * - mode === 'v1': giữ nguyên truy vấn 3 bảng hourly cũ để bảo đảm rollback an toàn.
 */
async function queryReportFull(
  db,
  filters,
  rollupUntil,
  { allMerchants = false, storageMode = null } = {}
) {
  const mode = storageMode || getAnalyticsStorageMode();
  const effectiveUntil = mode === "raw" ? null : rollupUntil;
  const hybrid = computeHybridWindow(
    filters.startInstant,
    filters.nextDayInstant,
    effectiveUntil
  );
  const params = [];
  const addParam = makeParamAdder(params);

  if (mode === "v2" || mode === "raw") {
    const groupParam = addParam(filters.group);
    const startParam = addParam(filters.startInstant);
    const endParam = addParam(filters.nextDayInstant);
    const limitParam = addParam(allMerchants ? null : filters.limit);
    const offsetParam = addParam(allMerchants ? 0 : (filters.page - 1) * filters.limit);

    let bucketTypeAggSql;
    let merchantTotalsSql;

    if (hybrid.useRollup && !hybrid.useTail) {
      // Exact Gate 4 benchmarked SQL path: zero CTE tuplestore materialization, 0 temp spill
      const dailyWhere = buildV2DailyWhere(
        addParam,
        filters,
        filters.startInstant,
        hybrid.splitInstant
      );
      bucketTypeAggSql = `
        SELECT
          date_trunc(${groupParam}, bucket_day::timestamp)::date AS bucket,
          transaction_type AS type,
          COALESCE(SUM(fee_amount), 0)::bigint AS revenue,
          COALESCE(SUM(tx_amount), 0)::bigint AS gross,
          COALESCE(SUM(tx_count), 0)::bigint AS transactions
        FROM public.report_merchant_financial_daily
        WHERE ${dailyWhere}
        GROUP BY 1, 2
      `;
      merchantTotalsSql = `
        SELECT
          merchant_id,
          COALESCE(SUM(fee_amount), 0)::bigint AS revenue,
          COALESCE(SUM(tx_amount), 0)::bigint AS gross,
          COALESCE(SUM(tx_count), 0)::bigint AS transactions
        FROM public.report_merchant_financial_daily
        WHERE ${dailyWhere}
        GROUP BY merchant_id
      `;
    } else {
      const bucketBranches = [];
      const merchBranches = [];

      if (hybrid.useRollup) {
        const dailyWhere = buildV2DailyWhere(
          addParam,
          filters,
          filters.startInstant,
          hybrid.splitInstant
        );
        bucketBranches.push(`
          SELECT
            date_trunc(${groupParam}, bucket_day::timestamp)::date AS bucket,
            transaction_type AS type,
            COALESCE(SUM(fee_amount), 0)::bigint AS revenue,
            COALESCE(SUM(tx_amount), 0)::bigint AS gross,
            COALESCE(SUM(tx_count), 0)::bigint AS transactions
          FROM public.report_merchant_financial_daily
          WHERE ${dailyWhere}
          GROUP BY 1, 2
        `);
        merchBranches.push(`
          SELECT
            merchant_id,
            COALESCE(SUM(fee_amount), 0)::bigint AS revenue,
            COALESCE(SUM(tx_amount), 0)::bigint AS gross,
            COALESCE(SUM(tx_count), 0)::bigint AS transactions
          FROM public.report_merchant_financial_daily
          WHERE ${dailyWhere}
          GROUP BY merchant_id
        `);
      }

      if (hybrid.useTail) {
        const tailFeeWhere = buildTailFeeConds(
          addParam,
          filters,
          hybrid.splitInstant,
          filters.nextDayInstant
        );
        const tailTxWhere = buildTailTxConds(
          addParam,
          filters,
          hybrid.splitInstant,
          filters.nextDayInstant
        );

        bucketBranches.push(`
          SELECT
            date_trunc(${groupParam}, l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket,
            t.transaction_type::text AS type,
            COALESCE(SUM(l.amount), 0)::bigint AS revenue,
            0::bigint AS gross,
            0::bigint AS transactions
          FROM public.fee_ledger_entries l
          JOIN public.transactions t ON t.id = l.transaction_id
          JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
          WHERE ${tailFeeWhere}
          GROUP BY 1, 2
        `);
        bucketBranches.push(`
          SELECT
            date_trunc(${groupParam}, t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket,
            t.transaction_type::text AS type,
            0::bigint AS revenue,
            COALESCE(SUM(t.amount), 0)::bigint AS gross,
            COUNT(*)::bigint AS transactions
          FROM public.transactions t
          JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
          WHERE ${tailTxWhere}
          GROUP BY 1, 2
        `);

        merchBranches.push(`
          SELECT
            u.id AS merchant_id,
            COALESCE(SUM(l.amount), 0)::bigint AS revenue,
            0::bigint AS gross,
            0::bigint AS transactions
          FROM public.fee_ledger_entries l
          JOIN public.transactions t ON t.id = l.transaction_id
          JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
          WHERE ${tailFeeWhere}
          GROUP BY u.id
        `);
        merchBranches.push(`
          SELECT
            u.id AS merchant_id,
            0::bigint AS revenue,
            COALESCE(SUM(t.amount), 0)::bigint AS gross,
            COUNT(*)::bigint AS transactions
          FROM public.transactions t
          JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
          WHERE ${tailTxWhere}
          GROUP BY u.id
        `);
      }

      bucketTypeAggSql =
        bucketBranches.length > 0
          ? `
            SELECT bucket, type,
                   SUM(revenue)::bigint AS revenue,
                   SUM(gross)::bigint AS gross,
                   SUM(transactions)::bigint AS transactions
            FROM (${bucketBranches.join("\n UNION ALL \n")}) btb
            GROUP BY 1, 2
          `
          : `SELECT NULL::date AS bucket, NULL::text AS type, 0::bigint AS revenue, 0::bigint AS gross, 0::bigint AS transactions WHERE false`;

      merchantTotalsSql =
        merchBranches.length > 0
          ? `
            SELECT merchant_id,
                   SUM(revenue)::bigint AS revenue,
                   SUM(gross)::bigint AS gross,
                   SUM(transactions)::bigint AS transactions
            FROM (${merchBranches.join("\n UNION ALL \n")}) mtb
            GROUP BY merchant_id
          `
          : `SELECT NULL::uuid AS merchant_id, 0::bigint AS revenue, 0::bigint AS gross, 0::bigint AS transactions WHERE false`;
    }

    const gatewaySql = buildV2GatewayDirectSql(addParam, filters);

    const sql = `
      WITH bucket_type_agg AS (
        ${bucketTypeAggSql}
      ),
      breakdown_rows AS (
        SELECT
          types.type,
          COALESCE(SUM(f.revenue), 0)::bigint AS revenue,
          COALESCE(SUM(f.gross), 0)::bigint AS gross,
          COALESCE(SUM(f.transactions), 0)::bigint AS transactions
        FROM (VALUES ('PAYMENT'), ('TRANSFER')) AS types(type)
        LEFT JOIN bucket_type_agg f ON f.type = types.type
        GROUP BY types.type
      ),
      totals AS (
        SELECT
          COALESCE(SUM(revenue), 0)::bigint AS revenue,
          COALESCE(SUM(gross), 0)::bigint AS gross,
          COALESCE(SUM(transactions), 0)::bigint AS transactions
        FROM breakdown_rows
      ),
      fin_buckets AS (
        SELECT
          bucket,
          SUM(revenue)::bigint AS revenue,
          SUM(gross)::bigint AS gross,
          SUM(transactions)::bigint AS transactions
        FROM bucket_type_agg
        GROUP BY 1
      ),
      buckets AS (
        SELECT generate_series(
          date_trunc(${groupParam}, ${startParam}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
          date_trunc(${groupParam}, (${endParam}::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
          CASE ${groupParam}
            WHEN 'quarter' THEN interval '3 months'
            WHEN 'year' THEN interval '1 year'
            WHEN 'month' THEN interval '1 month'
            WHEN 'week' THEN interval '1 week'
            ELSE interval '1 day'
          END
        )::date AS bucket
      ),
      series AS (
        SELECT
          to_char(b.bucket, 'YYYY-MM-DD') AS bucket,
          COALESCE(fb.revenue, 0)::bigint AS revenue,
          COALESCE(fb.gross, 0)::bigint AS gross,
          COALESCE(fb.transactions, 0)::bigint AS transactions
        FROM buckets b
        LEFT JOIN fin_buckets fb ON fb.bucket = b.bucket
      ),
      merchant_totals AS (
        ${merchantTotalsSql}
      ),
      merchant_page AS (
        SELECT
          mt.merchant_id,
          u.full_name AS merchant_name,
          mt.revenue,
          mt.gross,
          mt.transactions
        FROM merchant_totals mt
        JOIN public.users u ON u.id = mt.merchant_id
        ORDER BY mt.revenue DESC, mt.merchant_id
        LIMIT ${limitParam} OFFSET ${offsetParam}
      ),
      gateway AS (
        ${gatewaySql}
      )
      SELECT jsonb_build_object(
        'overview', (SELECT to_jsonb(t) FROM totals t),
        'breakdown', (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.type) FROM breakdown_rows b),
        'timeseries', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.bucket) FROM series s),
        'merchants', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.revenue DESC, m.merchant_id) FROM merchant_page m), '[]'::jsonb),
        'total_merchants', (SELECT COUNT(*)::bigint FROM merchant_totals),
        'gateway', (SELECT to_jsonb(g) FROM gateway g)
      ) AS data
    `;

    const { rows } = await db.query(sql, params);
    return rows[0].data;
  }

  // v1 legacy full report query
  const feeUnion = buildV1FeeEventCtes(addParam, filters, hybrid);
  const txUnion = buildV1TxEventCtes(addParam, filters, hybrid);
  const gwUnion = buildV1GatewaySql(addParam, filters, hybrid);

  const groupParam = addParam(filters.group);
  const startParam = addParam(filters.startInstant);
  const endParam = addParam(filters.nextDayInstant);
  const limitParam = addParam(allMerchants ? null : filters.limit);
  const offsetParam = addParam(allMerchants ? 0 : (filters.page - 1) * filters.limit);

  const sql = `
    WITH fee_rows AS (
      ${feeUnion || "SELECT NULL::timestamptz AS bucket_hour, NULL::uuid AS merchant_id, NULL::text AS type, 0::numeric AS revenue WHERE false"}
    ),
    tx_rows AS (
      ${txUnion || "SELECT NULL::timestamptz AS bucket_hour, NULL::uuid AS merchant_id, NULL::text AS type, 0::numeric AS gross, 0::bigint AS tx_count WHERE false"}
    ),
    fee_by_type AS (
      SELECT type, SUM(revenue)::bigint AS revenue FROM fee_rows GROUP BY type
    ),
    tx_by_type AS (
      SELECT type, SUM(gross)::bigint AS gross, SUM(tx_count)::bigint AS transactions FROM tx_rows GROUP BY type
    ),
    breakdown_rows AS (
      SELECT
        types.type,
        COALESCE(f.revenue, 0)::bigint AS revenue,
        COALESCE(t.gross, 0)::bigint AS gross,
        COALESCE(t.transactions, 0)::bigint AS transactions
      FROM (VALUES ('PAYMENT'), ('TRANSFER')) AS types(type)
      LEFT JOIN fee_by_type f ON f.type = types.type
      LEFT JOIN tx_by_type t ON t.type = types.type
    ),
    totals AS (
      SELECT
        COALESCE(SUM(revenue), 0)::bigint AS revenue,
        COALESCE(SUM(gross), 0)::bigint AS gross,
        COALESCE(SUM(transactions), 0)::bigint AS transactions
      FROM breakdown_rows
    ),
    fee_buckets AS (
      SELECT
        date_trunc(${groupParam}, bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
        SUM(revenue)::bigint AS revenue
      FROM fee_rows
      GROUP BY 1
    ),
    tx_buckets AS (
      SELECT
        date_trunc(${groupParam}, bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
        SUM(gross)::bigint AS gross,
        SUM(tx_count)::bigint AS transactions
      FROM tx_rows
      GROUP BY 1
    ),
    buckets AS (
      SELECT generate_series(
        date_trunc(${groupParam}, ${startParam}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'),
        date_trunc(${groupParam}, (${endParam}::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
        CASE ${groupParam}
          WHEN 'quarter' THEN interval '3 months'
          WHEN 'year' THEN interval '1 year'
          WHEN 'month' THEN interval '1 month'
          WHEN 'week' THEN interval '1 week'
          ELSE interval '1 day'
        END
      ) AS bucket
    ),
    series AS (
      SELECT
        to_char(b.bucket, 'YYYY-MM-DD') AS bucket,
        COALESCE(fb.revenue, 0)::bigint AS revenue,
        COALESCE(tb.gross, 0)::bigint AS gross,
        COALESCE(tb.transactions, 0)::bigint AS transactions
      FROM buckets b
      LEFT JOIN fee_buckets fb ON fb.bucket = b.bucket
      LEFT JOIN tx_buckets tb ON tb.bucket = b.bucket
    ),
    fee_merchants AS (
      SELECT merchant_id, SUM(revenue)::bigint AS revenue FROM fee_rows GROUP BY merchant_id
    ),
    tx_merchants AS (
      SELECT merchant_id, SUM(gross)::bigint AS gross, SUM(tx_count)::bigint AS transactions FROM tx_rows GROUP BY merchant_id
    ),
    merchant_totals AS (
      SELECT
        COALESCE(fm.merchant_id, tm.merchant_id) AS merchant_id,
        COALESCE(fm.revenue, 0)::bigint AS revenue,
        COALESCE(tm.gross, 0)::bigint AS gross,
        COALESCE(tm.transactions, 0)::bigint AS transactions
      FROM fee_merchants fm
      FULL OUTER JOIN tx_merchants tm ON fm.merchant_id = tm.merchant_id
    ),
    merchant_page AS (
      SELECT
        mt.merchant_id,
        u.full_name AS merchant_name,
        mt.revenue,
        mt.gross,
        mt.transactions
      FROM merchant_totals mt
      JOIN public.users u ON u.id = mt.merchant_id
      ORDER BY mt.revenue DESC, mt.merchant_id
      LIMIT ${limitParam} OFFSET ${offsetParam}
    ),
    gateway AS (
      SELECT
        COALESCE(SUM(total), 0)::bigint AS total,
        COALESCE(SUM(success), 0)::bigint AS success,
        COALESCE(SUM(pending), 0)::bigint AS pending,
        COALESCE(SUM(expired), 0)::bigint AS expired,
        COALESCE(SUM(failed), 0)::bigint AS failed,
        COALESCE(SUM(cancelled), 0)::bigint AS cancelled
      FROM (${gwUnion || "SELECT 0::bigint AS total, 0::bigint AS success, 0::bigint AS pending, 0::bigint AS expired, 0::bigint AS failed, 0::bigint AS cancelled"}) g
    )
    SELECT jsonb_build_object(
      'overview', (SELECT to_jsonb(t) FROM totals t),
      'breakdown', (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.type) FROM breakdown_rows b),
      'timeseries', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.bucket) FROM series s),
      'merchants', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.revenue DESC, m.merchant_id) FROM merchant_page m), '[]'::jsonb),
      'total_merchants', (SELECT COUNT(*)::bigint FROM merchant_totals),
      'gateway', (SELECT to_jsonb(g) FROM gateway g)
    ) AS data
  `;

  const { rows } = await db.query(sql, params);
  return rows[0].data;
}

/**
 * Chuỗi phí QR Merchant cho Export Excel 9 sheet (v2 đọc report_merchant_financial_daily + tail).
 */
async function queryMerchantFeeSeries(db, filters, rollupUntil) {
  const hybrid = computeHybridWindow(
    filters.startInstant,
    filters.nextDayInstant,
    rollupUntil
  );
  const params = [];
  const addParam = makeParamAdder(params);
  const groupParam = addParam(filters.group);
  const parts = [];

  if (hybrid.useRollup) {
    const dailyWhere = buildV2DailyWhere(
      addParam,
      filters,
      filters.startInstant,
      hybrid.splitInstant
    );
    parts.push(`
      SELECT date_trunc(${groupParam}, bucket_day::timestamp)::date AS b_date,
             COALESCE(SUM(fee_amount) FILTER (WHERE transaction_type = 'PAYMENT'), 0)::bigint AS payment_fee,
             COALESCE(SUM(fee_amount) FILTER (WHERE transaction_type = 'TRANSFER'), 0)::bigint AS transfer_fee
      FROM public.report_merchant_financial_daily
      WHERE ${dailyWhere}
        AND fee_tx_count > 0
      GROUP BY 1
    `);
  }

  if (hybrid.useTail) {
    const tailFeeWhere = buildTailFeeConds(
      addParam,
      filters,
      hybrid.splitInstant,
      filters.nextDayInstant
    );
    parts.push(`
      SELECT date_trunc(${groupParam}, l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS b_date,
             COALESCE(SUM(l.amount) FILTER (WHERE t.transaction_type = 'PAYMENT'), 0)::bigint AS payment_fee,
             COALESCE(SUM(l.amount) FILTER (WHERE t.transaction_type = 'TRANSFER'), 0)::bigint AS transfer_fee
      FROM public.fee_ledger_entries l
      JOIN public.transactions t ON t.id = l.transaction_id
      JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
      WHERE ${tailFeeWhere}
      GROUP BY 1
    `);
  }

  if (parts.length === 0) return [];
  const { rows } = await db.query(
    `
    SELECT to_char(b_date, 'YYYY-MM-DD') AS bucket,
           SUM(payment_fee)::bigint AS payment_fee,
           SUM(transfer_fee)::bigint AS transfer_fee
    FROM (${parts.join("\n UNION ALL \n")}) u
    GROUP BY b_date
    ORDER BY b_date
    `,
    params
  );
  return rows.map((r) => ({
    bucket: r.bucket,
    payment_fee: Number(r.payment_fee || 0),
    transfer_fee: Number(r.transfer_fee || 0),
  }));
}

function buildGrowthVolumeBranch(addParam, filters, win, hybrid, bucketLabel) {
  const branches = [];

  if (hybrid.useRollup) {
    const s = addParam(win.start);
    const e = addParam(hybrid.splitInstant);
    const conds = [
      `UPPER(status) IN ('SUCCESS', 'COMPLETED')`,
      `bucket_hour >= ${s}`,
      `bucket_hour < ${e}`,
    ];
    if (filters.type) {
      conds.push(`transaction_type = ${addParam(filters.type)}`);
    }
    branches.push(`
      SELECT
        ${bucketLabel} AS period_side,
        COALESCE(SUM(tx_count), 0)::bigint AS tx_count,
        COALESCE(SUM(total_amount), 0)::numeric AS gross
      FROM public.dashboard_tx_hourly
      WHERE ${conds.join(" AND ")}
    `);
  }

  if (hybrid.useTail) {
    const s = addParam(hybrid.splitInstant);
    const e = addParam(win.end);
    const conds = [
      `t.status IN ('SUCCESS', 'COMPLETED')`,
      `t.created_at >= ${s}`,
      `t.created_at < ${e}`,
    ];
    if (filters.type) {
      conds.push(`t.transaction_type = ${addParam(filters.type)}`);
    }
    branches.push(`
      SELECT
        ${bucketLabel} AS period_side,
        COUNT(*)::bigint AS tx_count,
        COALESCE(SUM(t.amount), 0)::numeric AS gross
      FROM public.transactions t
      WHERE ${conds.join(" AND ")}
    `);
  }

  return branches;
}

/**
 * Truy vấn growth volume tái sử dụng dashboard_tx_hourly khi merchant_id rỗng;
 * fallback sang truy vấn transactions trực tiếp khi lọc merchant_id hoặc ở raw mode / fallback 42P01.
 */
async function queryGrowthVolume(db, filters, previousStart, dashRollupUntil, options = {}) {
  const mode = options.storageMode || getAnalyticsStorageMode();
  const effectiveDashUntil = mode === "raw" ? null : dashRollupUntil;

  if (!filters.merchant && effectiveDashUntil) {
    const params = [];
    const addParam = makeParamAdder(params);
    const prevWin = { start: previousStart, end: filters.startInstant };
    const currWin = { start: filters.startInstant, end: filters.nextDayInstant };

    const prevHybrid = computeHybridWindow(prevWin.start, prevWin.end, effectiveDashUntil);
    const currHybrid = computeHybridWindow(currWin.start, currWin.end, effectiveDashUntil);

    const allBranches = [
      ...buildGrowthVolumeBranch(addParam, filters, prevWin, prevHybrid, `'prev'::text`),
      ...buildGrowthVolumeBranch(addParam, filters, currWin, currHybrid, `'curr'::text`),
    ];

    if (allBranches.length > 0) {
      const { rows } = await db.query(
        `
        SELECT
          COALESCE(SUM(tx_count) FILTER (WHERE period_side = 'curr'), 0)::bigint AS current_count,
          COALESCE(SUM(tx_count) FILTER (WHERE period_side = 'prev'), 0)::bigint AS previous_count,
          COALESCE(SUM(gross) FILTER (WHERE period_side = 'curr'), 0)::bigint AS current_gross,
          COALESCE(SUM(gross) FILTER (WHERE period_side = 'prev'), 0)::bigint AS previous_gross
        FROM (
          ${allBranches.join("\n          UNION ALL\n")}
        ) g
        `,
        params
      );
      const r = rows[0];
      return {
        current_count: Number(r?.current_count || 0),
        previous_count: Number(r?.previous_count || 0),
        current_gross: Number(r?.current_gross || 0),
        previous_gross: Number(r?.previous_gross || 0),
      };
    }
  }

  const params = [filters.startInstant, filters.nextDayInstant, previousStart];
  const conds = [
    `t.status IN ('SUCCESS', 'COMPLETED')`,
    `t.created_at >= $3`,
    `t.created_at < $2`,
  ];
  if (filters.type) {
    params.push(filters.type);
    conds.push(`t.transaction_type = $${params.length}`);
  }
  if (filters.merchant) {
    params.push(filters.merchant);
    conds.push(`t.destination_user_id = $${params.length}::uuid`);
  }

  const { rows } = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE t.created_at >= $1)::bigint AS current_count,
      COUNT(*) FILTER (WHERE t.created_at < $1)::bigint AS previous_count,
      COALESCE(SUM(t.amount) FILTER (WHERE t.created_at >= $1), 0)::bigint AS current_gross,
      COALESCE(SUM(t.amount) FILTER (WHERE t.created_at < $1), 0)::bigint AS previous_gross
    FROM public.transactions t
    WHERE ${conds.join(" AND ")}
    `,
    params
  );
  const r = rows[0];
  return {
    current_count: Number(r?.current_count || 0),
    previous_count: Number(r?.previous_count || 0),
    current_gross: Number(r?.current_gross || 0),
    previous_gross: Number(r?.previous_gross || 0),
  };
}

module.exports = {
  REPORT_ROLLUP_LOCK_KEY,
  isMissingRelationError,
  computeReportTargetCutoff,
  getReportRollupState,
  reconcileReportDirtyHours,
  reconcileReportDaysV2,
  ensureReportRollupConsistent,
  advanceReportRollupCutoff,
  computeHybridWindow,
  queryFeeRevenueSummary,
  queryMerchantsPage,
  queryReportFull,
  queryMerchantFeeSeries,
  queryGrowthVolume,
  getAnalyticsRollupHealth,
};
