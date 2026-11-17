const pool = require("../../config/database");
const { computeHybridWindow } = require("../dashboard/dashboardRollup");

const REPORT_ROLLUP_LOCK_KEY = 2026111602;

let inFlightReconcile = null;

function isMissingRelationError(err) {
  return Boolean(err && err.code === "42P01");
}

function makeParamAdder(params) {
  return (value) => {
    params.push(value);
    return `$${params.length}`;
  };
}

/**
 * Đọc mốc rollup_until và trạng thái dirty hours của phân hệ Báo cáo.
 */
async function getReportRollupState(db = pool) {
  try {
    const { rows } = await db.query(`
      SELECT
        rollup_until,
        (rollup_until > '-infinity'::timestamptz AND rollup_until < 'infinity'::timestamptz) AS is_finite,
        EXISTS (SELECT 1 FROM public.report_dirty_hours LIMIT 1) AS has_dirty
      FROM public.report_rollup_state
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
    if (isMissingRelationError(err)) {
      return { rollupUntil: null, isFinite: false, hasDirty: false };
    }
    throw err;
  }
}

/**
 * Đối soát có chọn lọc từng miền bảng rollup dựa trên cờ dirty_fee / dirty_tx / dirty_gateway.
 */
async function reconcileReportDirtyHours(db = pool) {
  if (db === pool && inFlightReconcile) {
    return inFlightReconcile;
  }

  const run = async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        REPORT_ROLLUP_LOCK_KEY,
      ]);

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
          [feeHours],
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
            GROUP BY 1, 2, 3
            ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
              fee_amount = EXCLUDED.fee_amount,
              fee_tx_count = EXCLUDED.fee_tx_count,
              updated_at = NOW()
            `,
            [feeHours, rollupUntil],
          );
        }
      }

      if (txHours.length > 0) {
        await client.query(
          `DELETE FROM public.report_merchant_tx_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
          [txHours],
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
            GROUP BY 1, 2, 3
            ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
              tx_count = EXCLUDED.tx_count,
              tx_amount = EXCLUDED.tx_amount,
              merchant_fee_total = EXCLUDED.merchant_fee_total,
              updated_at = NOW()
            `,
            [txHours, rollupUntil],
          );
        }
      }

      if (gatewayHours.length > 0) {
        await client.query(
          `DELETE FROM public.report_gateway_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
          [gatewayHours],
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
            [gatewayHours, rollupUntil],
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
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (isMissingRelationError(err)) {
        return { rollupUntil: null, reconciledHours: 0, skippedMissingSchema: true };
      }
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

async function ensureReportRollupConsistent(db = pool) {
  const state = await getReportRollupState(db);
  if (!state.hasDirty) {
    return state.rollupUntil;
  }
  const result = await reconcileReportDirtyHours(db);
  return result.rollupUntil;
}

/**
 * Cuộn mốc report_rollup_state.rollup_until về 00:00 hôm nay theo Asia/Ho_Chi_Minh.
 * Chia bước tối đa 7 ngày để giữ lock ngắn và tự động bỏ qua nếu thiếu bảng rollup (42P01).
 */
async function advanceReportRollupCutoff(db = pool) {
  const reconcileResult = await reconcileReportDirtyHours(db);
  if (reconcileResult.skippedMissingSchema) {
    return { rollupUntil: null, rolledUpRows: 0, skippedMissingSchema: true };
  }

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
        [currentUntil, nextCutoff],
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
          AND l.created_at >= $1
          AND l.created_at < $2
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
          fee_amount = EXCLUDED.fee_amount,
          fee_tx_count = EXCLUDED.fee_tx_count,
          updated_at = NOW()
        `,
        [currentUntil, nextCutoff],
      );

      await client.query(
        `DELETE FROM public.report_merchant_tx_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
        [currentUntil, nextCutoff],
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
          AND t.created_at >= $1
          AND t.created_at < $2
        GROUP BY 1, 2, 3
        ON CONFLICT (bucket_hour, merchant_id, transaction_type) DO UPDATE SET
          tx_count = EXCLUDED.tx_count,
          tx_amount = EXCLUDED.tx_amount,
          merchant_fee_total = EXCLUDED.merchant_fee_total,
          updated_at = NOW()
        `,
        [currentUntil, nextCutoff],
      );

      await client.query(
        `DELETE FROM public.report_gateway_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
        [currentUntil, nextCutoff],
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
        [currentUntil, nextCutoff],
      );

      await client.query(
        `DELETE FROM public.report_dirty_hours WHERE bucket_hour >= $1 AND bucket_hour < $2`,
        [currentUntil, nextCutoff],
      );

      await client.query(
        `UPDATE public.report_rollup_state SET rollup_until = $1, updated_at = NOW() WHERE id = 1`,
        [nextCutoff],
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
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (isMissingRelationError(err)) {
      return { rollupUntil: null, rolledUpRows: 0, skippedMissingSchema: true };
    }
    throw err;
  } finally {
    client.release();
  }
}

function buildFeeEventCtes(addParam, filters, hybrid) {
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

function buildTxEventCtes(addParam, filters, hybrid) {
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

function buildGatewaySql(addParam, filters, hybrid) {
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

/**
 * Truy vấn nhanh chỉ KPI Doanh thu phí Merchant (scope=kpi) bằng Hybrid Rollup + tail.
 */
async function queryFeeRevenueSummary(db, filters, rollupUntil) {
  const hybrid = computeHybridWindow(
    filters.startInstant,
    filters.nextDayInstant,
    rollupUntil,
  );
  const params = [];
  const addParam = makeParamAdder(params);
  const feeUnion = buildFeeEventCtes(addParam, filters, hybrid);
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
  { allMerchants = false } = {},
) {
  const hybrid = computeHybridWindow(
    filters.startInstant,
    filters.nextDayInstant,
    rollupUntil,
  );
  const params = [];
  const addParam = makeParamAdder(params);

  const feeUnion = buildFeeEventCtes(addParam, filters, hybrid);
  const txUnion = buildTxEventCtes(addParam, filters, hybrid);
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
    // When page > total_pages, paged is empty so check exact total_merchants if offset > 0
    if (!allMerchants && filters.page > 1) {
      const countParams = [];
      const addCountParam = makeParamAdder(countParams);
      const feeCountUnion = buildFeeEventCtes(addCountParam, filters, hybrid);
      const txCountUnion = buildTxEventCtes(addCountParam, filters, hybrid);
      const countRes = await db.query(
        `
        WITH ids AS (
          SELECT merchant_id FROM (${feeCountUnion}) f GROUP BY merchant_id
          UNION
          SELECT merchant_id FROM (${txCountUnion}) tx GROUP BY merchant_id
        )
        SELECT COUNT(*)::int AS total_merchants FROM ids
        `,
        countParams,
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

/**
 * Truy vấn đầy đủ báo cáo (overview, breakdown, timeseries, merchants, gateway) từ Hybrid Rollup + tail.
 */
async function queryReportFull(
  db,
  filters,
  rollupUntil,
  { allMerchants = false } = {},
) {
  const hybrid = computeHybridWindow(
    filters.startInstant,
    filters.nextDayInstant,
    rollupUntil,
  );
  const params = [];
  const addParam = makeParamAdder(params);

  const feeUnion = buildFeeEventCtes(addParam, filters, hybrid);
  const txUnion = buildTxEventCtes(addParam, filters, hybrid);
  const gwUnion = buildGatewaySql(addParam, filters, hybrid);

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
      FROM (
        ${gwUnion || "SELECT 0::bigint AS total, 0::bigint AS success, 0::bigint AS pending, 0::bigint AS expired, 0::bigint AS failed, 0::bigint AS cancelled"}
      ) gw_parts
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

function buildGrowthVolumeBranch(addParam, filters, win, hybrid, bucketLabel) {
  const branches = [];

  if (hybrid.useRollup) {
    const s = addParam(win.start);
    const e = addParam(hybrid.splitInstant);
    const conds = [
      `bucket_hour >= ${s}`,
      `bucket_hour < ${e}`,
      `UPPER(status) IN ('SUCCESS', 'COMPLETED')`,
    ];
    if (filters.type) {
      conds.push(`UPPER(transaction_type) = ${addParam(filters.type)}`);
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
 * fallback sang truy vấn transactions trực tiếp (qua index) khi lọc merchant_id hoặc thiếu bảng rollup (42P01).
 */
async function queryGrowthVolume(db, filters, previousStart, dashRollupUntil) {
  if (!filters.merchant && dashRollupUntil) {
    const params = [];
    const addParam = makeParamAdder(params);
    const prevWin = { start: previousStart, end: filters.startInstant };
    const currWin = { start: filters.startInstant, end: filters.nextDayInstant };

    const prevHybrid = computeHybridWindow(prevWin.start, prevWin.end, dashRollupUntil);
    const currHybrid = computeHybridWindow(currWin.start, currWin.end, dashRollupUntil);

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
        params,
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

  // Fallback or merchant-filtered path using (destination_user_id, created_at) / created_at indexes without redundant column casts
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
    params,
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
  getReportRollupState,
  reconcileReportDirtyHours,
  ensureReportRollupConsistent,
  advanceReportRollupCutoff,
  computeHybridWindow,
  queryFeeRevenueSummary,
  queryMerchantsPage,
  queryReportFull,
  queryGrowthVolume,
};
