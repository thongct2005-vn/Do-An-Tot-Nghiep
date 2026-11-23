// financialReport.repository.js: Truy vấn tổng hợp báo cáo tài chính (dòng tiền, phí, chuỗi hệ thống, đối chiếu) theo snapshot Admin.
const {
  queryReportFull,
  computeHybridWindow,
  isMissingRelationError,
} = require("./reportRollup");
const {
  exactInteger,
  normalizeIntegers,
  previousRange,
} = require("./financialReport.data");
const {
  SUCCESS,
  numericRows,
  queryCashflowRaw,
  verifyQrFeeRollupWindow,
  queryFeesRaw,
  querySystemSeriesRaw,
  queryControlsRaw,
  queryMerchantFeeSeriesRaw,
  queryCombinedVerifiedFees,
  queryCombinedTransactions,
  readSnapshotRollupState,
} = require("./financialReport.queries");

const adminFinancialReportRepository = {
  // Accept a caller-owned connection: export can read all sections in one snapshot.
  // No pool access or rollup maintenance is allowed in this repository.
  async merchantReport(db, filters, rollupUntil = null) {
    try {
      return normalizeIntegers(
        await queryReportFull(db, filters, rollupUntil, { allMerchants: true }),
      );
    } catch (err) {
      if (rollupUntil && isMissingRelationError(err)) {
        return normalizeIntegers(
          await queryReportFull(db, filters, null, { allMerchants: true }),
        );
      }
      throw err;
    }
  },

  verifyQrFeeRollupWindow,
  readSnapshotRollupState,

  async cashflow(db, filters, dashRollupUntil = null) {
    const dashHybrid = computeHybridWindow(
      filters.startInstant,
      filters.nextDayInstant,
      dashRollupUntil,
    );
    if (!dashHybrid.useRollup) {
      return queryCashflowRaw(db, filters);
    }
    try {
      const { rows } = await db.query(
        `WITH tx_events AS (
          SELECT
            CASE
              WHEN d.transaction_type = 'REFUND' THEN 'PAYMENT_REVERSAL'
              ELSE d.transaction_type::text
            END AS type,
            d.status::text AS status,
            d.tx_count::bigint AS tx_count,
            d.total_amount::numeric AS total_amount
          FROM public.dashboard_tx_hourly d
          WHERE d.bucket_hour >= $1 AND d.bucket_hour < $3
          UNION ALL
          SELECT
            adj.adj_type AS type,
            r.status,
            (r.tx_count * adj.sign)::bigint AS tx_count,
            (r.total_amount * adj.sign)::numeric AS total_amount
          FROM (
            SELECT
              t.status::text AS status,
              count(*)::bigint AS tx_count,
              coalesce(sum(t.amount), 0)::numeric AS total_amount
            FROM public.transactions t
            WHERE t.transaction_type = 'TRANSFER'
              AND t.created_at >= $1 AND t.created_at < $3
              AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') = 'REVERSAL'
            GROUP BY 1
          ) r
          CROSS JOIN (VALUES ('TRANSFER'::text, -1), ('PAYMENT_REVERSAL'::text, 1)) AS adj(adj_type, sign)
          UNION ALL
          SELECT
            CASE
              WHEN t.transaction_type='REFUND'
                OR (t.transaction_type='TRANSFER' AND COALESCE(t.fee_rate_snapshot->>'operation_type','')='REVERSAL')
              THEN 'PAYMENT_REVERSAL'
              ELSE t.transaction_type::text
            END AS type,
            t.status::text AS status,
            count(*)::bigint AS tx_count,
            coalesce(sum(t.amount), 0)::numeric AS total_amount
          FROM public.transactions t
          WHERE $4::boolean AND t.created_at >= $3 AND t.created_at < $2
          GROUP BY 1, 2
        )
        SELECT
          type,
          coalesce(sum(tx_count), 0) AS total,
          coalesce(sum(tx_count) FILTER (WHERE status IN ${SUCCESS}), 0) AS success,
          coalesce(sum(tx_count) FILTER (WHERE status='PENDING'), 0) AS pending,
          coalesce(sum(tx_count) FILTER (WHERE status='FAILED'), 0) AS failed,
          coalesce(sum(tx_count) FILTER (WHERE status NOT IN ('SUCCESS','COMPLETED','PENDING','FAILED')), 0) AS other,
          coalesce(sum(total_amount) FILTER (WHERE status IN ${SUCCESS}), 0) AS gross
        FROM tx_events
        GROUP BY 1
        HAVING coalesce(sum(tx_count), 0) > 0
        ORDER BY 1`,
        [
          filters.startInstant,
          filters.nextDayInstant,
          dashHybrid.splitInstant,
          dashHybrid.useTail,
        ],
      );
      const data = numericRows(rows, [
        "total",
        "success",
        "pending",
        "failed",
        "other",
        "gross",
      ]);
      for (const type of ["TOPUP", "WITHDRAW", "TRANSFER", "PAYMENT"]) {
        if (!data.some((row) => row.type === type)) {
          data.push({
            type,
            total: 0,
            success: 0,
            pending: 0,
            failed: 0,
            other: 0,
            gross: 0,
          });
        }
      }
      return data;
    } catch (err) {
      if (isMissingRelationError(err)) return queryCashflowRaw(db, filters);
      throw err;
    }
  },

  async fees(db, filters, rollupUntil = null, verifiedQrRollup = null) {
    const hybrid = computeHybridWindow(
      filters.startInstant,
      filters.nextDayInstant,
      rollupUntil,
    );
    if (!hybrid.useRollup) {
      return queryFeesRaw(db, filters);
    }
    const canUse =
      verifiedQrRollup !== null
        ? verifiedQrRollup
        : await verifyQrFeeRollupWindow(
            db,
            filters.startInstant,
            hybrid.splitInstant,
          );
    if (!canUse) {
      return queryFeesRaw(db, filters);
    }
    try {
      const { rows } = await db.query(
        `WITH residual_ledger AS MATERIALIZED (
          SELECT l.amount, l.created_at, l.fee_type, l.transaction_id
          FROM public.fee_ledger_entries l
          WHERE l.fee_type <> 'QR_FEE' AND l.created_at >= $1 AND l.created_at < $2
          UNION ALL
          SELECT l.amount, l.created_at, l.fee_type, l.transaction_id
          FROM public.fee_ledger_entries l
          WHERE $4::boolean AND l.fee_type = 'QR_FEE' AND l.created_at >= $3 AND l.created_at < $2
        ),
        residual_source AS (
          SELECT l.amount, l.created_at, l.fee_type,
            CASE WHEN l.fee_type='QR_FEE' THEN 'QR_FEE_' || COALESCE(t.transaction_type::text,'UNKNOWN')
              ELSE l.fee_type END AS category,
            CASE WHEN l.fee_type='QR_FEE' THEN
              COALESCE(t.status IN ${SUCCESS} AND u.role='MERCHANT'
                AND t.transaction_type::text IN ('PAYMENT','TRANSFER')
                AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL',false)
              WHEN l.transaction_id IS NULL THEN l.fee_type='MONTHLY_PLAN_FEE'
              ELSE COALESCE(t.status IN ${SUCCESS},false) END AS eligible
          FROM residual_ledger l
          LEFT JOIN public.transactions t ON t.id = l.transaction_id
          LEFT JOIN public.users u ON u.id = t.destination_user_id
        ),
        combined AS (
          SELECT ('QR_FEE_' || r.transaction_type)::text AS category,
            true AS eligible,
            r.fee_tx_count::bigint AS entries,
            r.fee_amount::numeric AS revenue
          FROM public.report_merchant_fee_hourly r
          WHERE r.bucket_hour >= $1 AND r.bucket_hour < $3 AND r.fee_tx_count > 0
          UNION ALL
          SELECT category, eligible, 1::bigint AS entries, amount::numeric AS revenue
          FROM residual_source
        )
        SELECT category, eligible, coalesce(sum(entries), 0) AS entries, coalesce(sum(revenue), 0) AS revenue
        FROM combined
        GROUP BY category, eligible
        ORDER BY category, eligible`,
        [
          filters.startInstant,
          filters.nextDayInstant,
          hybrid.splitInstant,
          hybrid.useTail,
        ],
      );
      return numericRows(rows, ["entries", "revenue"]);
    } catch (err) {
      if (isMissingRelationError(err)) return queryFeesRaw(db, filters);
      throw err;
    }
  },

  async systemSeries(
    db,
    filters,
    rollupUntil = null,
    verifiedQrRollup = null,
  ) {
    const hybrid = computeHybridWindow(
      filters.startInstant,
      filters.nextDayInstant,
      rollupUntil,
    );
    if (!hybrid.useRollup) {
      return querySystemSeriesRaw(db, filters);
    }
    const canUse =
      verifiedQrRollup !== null
        ? verifiedQrRollup
        : await verifyQrFeeRollupWindow(
            db,
            filters.startInstant,
            hybrid.splitInstant,
          );
    if (!canUse) {
      return querySystemSeriesRaw(db, filters);
    }
    try {
      const { rows } = await db.query(
        `WITH residual_ledger AS MATERIALIZED (
          SELECT l.amount, l.created_at, l.fee_type, l.transaction_id
          FROM public.fee_ledger_entries l
          WHERE l.fee_type <> 'QR_FEE' AND l.created_at >= $1 AND l.created_at < $2
          UNION ALL
          SELECT l.amount, l.created_at, l.fee_type, l.transaction_id
          FROM public.fee_ledger_entries l
          WHERE $5::boolean AND l.fee_type = 'QR_FEE' AND l.created_at >= $4 AND l.created_at < $2
        ),
        residual_source AS (
          SELECT l.amount, l.created_at, l.fee_type,
            CASE WHEN l.fee_type='QR_FEE' THEN
              COALESCE(t.status IN ${SUCCESS} AND u.role='MERCHANT'
                AND t.transaction_type::text IN ('PAYMENT','TRANSFER')
                AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL',false)
              WHEN l.transaction_id IS NULL THEN l.fee_type='MONTHLY_PLAN_FEE'
              ELSE COALESCE(t.status IN ${SUCCESS},false) END AS eligible
          FROM residual_ledger l
          LEFT JOIN public.transactions t ON t.id = l.transaction_id
          LEFT JOIN public.users u ON u.id = t.destination_user_id
        ),
        fee_events AS (
          SELECT date_trunc($3, r.bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
            r.fee_amount::numeric AS revenue,
            r.fee_amount::numeric AS qr_fee
          FROM public.report_merchant_fee_hourly r
          WHERE r.bucket_hour >= $1 AND r.bucket_hour < $4 AND r.fee_tx_count > 0
          UNION ALL
          SELECT date_trunc($3, created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
            amount::numeric AS revenue,
            (CASE WHEN fee_type = 'QR_FEE' THEN amount ELSE 0 END)::numeric AS qr_fee
          FROM residual_source
          WHERE eligible
        ),
        fee_buckets AS (
          SELECT bucket, sum(revenue) AS revenue, coalesce(sum(qr_fee), 0) AS qr_fee
          FROM fee_events GROUP BY 1
        ),
        tx_buckets AS (
          SELECT date_trunc($3, created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') bucket,
            count(*) AS transactions,
            coalesce(sum(amount) FILTER (WHERE transaction_type='TOPUP'),0) AS topup,
            coalesce(sum(amount) FILTER (WHERE transaction_type='WITHDRAW'),0) AS withdraw,
            coalesce(sum(amount) FILTER (WHERE transaction_type='PAYMENT'),0) AS payment,
            coalesce(sum(amount) FILTER (WHERE transaction_type='TRANSFER' AND COALESCE(fee_rate_snapshot->>'operation_type','') <> 'REVERSAL'),0) AS transfer,
            coalesce(sum(amount) FILTER (WHERE transaction_type='REFUND' OR (transaction_type='TRANSFER' AND fee_rate_snapshot->>'operation_type'='REVERSAL')),0) AS payment_reversal
          FROM transactions WHERE created_at >= $1 AND created_at < $2 AND status IN ${SUCCESS} GROUP BY 1
        ),
        buckets AS (
          SELECT generate_series(date_trunc($3,$1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'),
            date_trunc($3,($2::timestamptz-interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
            CASE $3 WHEN 'year' THEN interval '1 year' WHEN 'quarter' THEN interval '3 months'
              WHEN 'month' THEN interval '1 month' WHEN 'week' THEN interval '1 week' ELSE interval '1 day' END) bucket
        )
        SELECT to_char(b.bucket,'YYYY-MM-DD') AS bucket,
          coalesce(t.topup,0) AS topup, coalesce(t.withdraw,0) AS withdraw,
          coalesce(t.payment,0) AS payment, coalesce(t.transfer,0) AS transfer,
          coalesce(t.payment_reversal,0) AS payment_reversal,
          coalesce(t.transactions,0) AS transactions, coalesce(f.revenue,0) AS revenue,
          coalesce(f.qr_fee,0) AS qr_fee
        FROM buckets b LEFT JOIN tx_buckets t USING(bucket) LEFT JOIN fee_buckets f USING(bucket)
        ORDER BY b.bucket`,
        [
          filters.startInstant,
          filters.nextDayInstant,
          filters.group,
          hybrid.splitInstant,
          hybrid.useTail,
        ],
      );
      return numericRows(rows, [
        "topup",
        "withdraw",
        "payment",
        "transfer",
        "payment_reversal",
        "transactions",
        "revenue",
        "qr_fee",
      ]);
    } catch (err) {
      if (isMissingRelationError(err)) return querySystemSeriesRaw(db, filters);
      throw err;
    }
  },

  async controls(db, filters, rollupUntil = null, verifiedQrRollup = null) {
    const hybrid = computeHybridWindow(
      filters.startInstant,
      filters.nextDayInstant,
      rollupUntil,
    );
    if (!hybrid.useRollup) {
      return queryControlsRaw(db, filters);
    }
    const canUse =
      verifiedQrRollup !== null
        ? verifiedQrRollup
        : await verifyQrFeeRollupWindow(
            db,
            filters.startInstant,
            hybrid.splitInstant,
          );
    if (!canUse) {
      return queryControlsRaw(db, filters);
    }
    try {
      const { rows } = await db.query(
        `WITH residual_ledger AS MATERIALIZED (
          SELECT l.amount, l.created_at, l.fee_type, l.transaction_id
          FROM public.fee_ledger_entries l
          WHERE l.fee_type <> 'QR_FEE' AND l.created_at >= $1 AND l.created_at < $2
          UNION ALL
          SELECT l.amount, l.created_at, l.fee_type, l.transaction_id
          FROM public.fee_ledger_entries l
          WHERE $4::boolean AND l.fee_type = 'QR_FEE' AND l.created_at >= $3 AND l.created_at < $2
        ),
        residual_source AS (
          SELECT l.amount, l.fee_type,
            CASE WHEN l.fee_type='QR_FEE' THEN
              COALESCE(t.status IN ${SUCCESS} AND u.role='MERCHANT'
                AND t.transaction_type::text IN ('PAYMENT','TRANSFER')
                AND COALESCE(t.fee_rate_snapshot->>'operation_type','') <> 'REVERSAL',false)
              WHEN l.transaction_id IS NULL THEN l.fee_type='MONTHLY_PLAN_FEE'
              ELSE COALESCE(t.status IN ${SUCCESS},false) END AS eligible
          FROM residual_ledger l
          LEFT JOIN public.transactions t ON t.id = l.transaction_id
          LEFT JOIN public.users u ON u.id = t.destination_user_id
        ),
        rollup_tot AS (
          SELECT coalesce(sum(fee_amount), 0) AS qr_rev
          FROM public.report_merchant_fee_hourly
          WHERE bucket_hour >= $1 AND bucket_hour < $3
        ),
        res_tot AS (
          SELECT
            coalesce(sum(amount) FILTER (WHERE eligible), 0) AS rev,
            coalesce(sum(amount) FILTER (WHERE eligible AND fee_type = 'QR_FEE'), 0) AS qr_rev
          FROM residual_source
        )
        SELECT
          ((SELECT qr_rev FROM rollup_tot) + (SELECT rev FROM res_tot))::text AS revenue,
          ((SELECT qr_rev FROM rollup_tot) + (SELECT qr_rev FROM res_tot))::text AS qr_fee,
          (SELECT count(*)::text FROM public.transactions WHERE created_at >= $1 AND created_at < $2) AS transactions`,
        [
          filters.startInstant,
          filters.nextDayInstant,
          hybrid.splitInstant,
          hybrid.useTail,
        ],
      );
      return numericRows(rows, ["revenue", "transactions", "qr_fee"])[0];
    } catch (err) {
      if (isMissingRelationError(err)) return queryControlsRaw(db, filters);
      throw err;
    }
  },

  async merchantFeeSeries(db, filters, rollupUntil = null) {
    const hybrid = computeHybridWindow(
      filters.startInstant,
      filters.nextDayInstant,
      rollupUntil,
    );
    if (!hybrid.useRollup) {
      return queryMerchantFeeSeriesRaw(db, filters);
    }
    try {
      const params = [
        filters.startInstant,
        hybrid.splitInstant,
        filters.group,
        filters.merchant,
        filters.type,
      ];
      const branches = [
        `SELECT date_trunc($3, r.bucket_hour AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
           r.transaction_type::text AS transaction_type,
           r.fee_amount AS amount
         FROM public.report_merchant_fee_hourly r
         WHERE r.bucket_hour >= $1 AND r.bucket_hour < $2
           AND ($4::uuid IS NULL OR r.merchant_id = $4)
           AND ($5::text IS NULL OR r.transaction_type = $5)`,
      ];
      if (hybrid.useTail) {
        params.push(filters.nextDayInstant);
        branches.push(
          `SELECT date_trunc($3, l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
             t.transaction_type::text AS transaction_type,
             l.amount AS amount
           FROM public.fee_ledger_entries l
           JOIN public.transactions t ON t.id = l.transaction_id
           JOIN public.users u ON u.id = t.destination_user_id
           WHERE l.created_at >= $2 AND l.created_at < $6
             AND l.fee_type = 'QR_FEE' AND t.status IN ${SUCCESS}
             AND u.role = 'MERCHANT' AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
             AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
             AND ($4::uuid IS NULL OR t.destination_user_id = $4)
             AND ($5::text IS NULL OR t.transaction_type::text = $5)`,
        );
      }
      const { rows } = await db.query(
        `WITH fee_events AS (${branches.join(" UNION ALL ")})
         SELECT to_char(bucket, 'YYYY-MM-DD') AS bucket,
           coalesce(sum(amount) FILTER (WHERE transaction_type = 'PAYMENT'), 0) AS payment_fee,
           coalesce(sum(amount) FILTER (WHERE transaction_type = 'TRANSFER'), 0) AS transfer_fee
         FROM fee_events
         GROUP BY 1 ORDER BY 1`,
        params,
      );
      return numericRows(rows, ["payment_fee", "transfer_fee"]);
    } catch (err) {
      if (isMissingRelationError(err)) {
        return queryMerchantFeeSeriesRaw(db, filters);
      }
      throw err;
    }
  },

  async readFinancialData(db, filters, options = {}) {
    const rollupUntil = options.rollupUntil || null;
    const dashRollupUntil = options.dashRollupUntil || null;
    const previous = previousRange(filters);
    const currHybrid = computeHybridWindow(
      filters.startInstant,
      filters.nextDayInstant,
      rollupUntil,
    );
    const prevHybrid = computeHybridWindow(
      previous.startInstant,
      previous.nextDayInstant,
      rollupUntil,
    );
    const currQrVerified = currHybrid.useRollup
      ? await verifyQrFeeRollupWindow(
          db,
          filters.startInstant,
          currHybrid.splitInstant,
        )
      : false;
    const prevQrVerified = prevHybrid.useRollup
      ? await verifyQrFeeRollupWindow(
          db,
          previous.startInstant,
          prevHybrid.splitInstant,
        )
      : false;

    if (currQrVerified) {
      try {
        const merchant = await adminFinancialReportRepository.merchantReport(
          db,
          filters,
          rollupUntil,
        );
        const { feesData, feeMap, merchantFeeSeriesUnfiltered, feeControls } =
          await queryCombinedVerifiedFees(db, filters, currHybrid);
        const merchant_fee_series =
          !filters.merchant && !filters.type
            ? merchantFeeSeriesUnfiltered
            : await adminFinancialReportRepository.merchantFeeSeries(
                db,
                filters,
                rollupUntil,
              );
        const { cashflowData, systemSeriesData, totalTransactions } =
          await queryCombinedTransactions(db, filters, feeMap, dashRollupUntil);
        const previous_cashflow = await adminFinancialReportRepository.cashflow(
          db,
          previous,
          dashRollupUntil,
        );
        const previous_fees = await adminFinancialReportRepository.fees(
          db,
          previous,
          rollupUntil,
          prevQrVerified,
        );
        return {
          merchant,
          merchant_fee_series,
          cashflow: cashflowData,
          previous_cashflow,
          fees: feesData,
          previous_fees,
          system_series: systemSeriesData,
          controls: {
            revenue: feeControls.revenue,
            transactions: totalTransactions,
            qr_fee: feeControls.qr_fee,
          },
        };
      } catch (err) {
        if (!isMissingRelationError(err)) throw err;
      }
    }

    // Sequential queries also work with a single transaction connection.
    return {
      merchant: await adminFinancialReportRepository.merchantReport(
        db,
        filters,
        rollupUntil,
      ),
      merchant_fee_series:
        await adminFinancialReportRepository.merchantFeeSeries(
          db,
          filters,
          rollupUntil,
        ),
      cashflow: await adminFinancialReportRepository.cashflow(
        db,
        filters,
        dashRollupUntil,
      ),
      previous_cashflow: await adminFinancialReportRepository.cashflow(
        db,
        previous,
        dashRollupUntil,
      ),
      fees: await adminFinancialReportRepository.fees(
        db,
        filters,
        rollupUntil,
        currQrVerified,
      ),
      previous_fees: await adminFinancialReportRepository.fees(
        db,
        previous,
        rollupUntil,
        prevQrVerified,
      ),
      system_series: await adminFinancialReportRepository.systemSeries(
        db,
        filters,
        rollupUntil,
        currQrVerified,
      ),
      controls: await adminFinancialReportRepository.controls(
        db,
        filters,
        rollupUntil,
        currQrVerified,
      ),
    };
  },

  async getSnapshotAdminMetadata(client, adminId) {
    const { rows } = await client.query(
      "SELECT clock_timestamp() AS snapshot_at, full_name AS admin_name FROM users WHERE id=$1",
      [adminId],
    );
    return rows[0] || null;
  },

  async getAccountGrowthRows(client, filters, previous) {
    const { rows } = await client.query(
      `SELECT role,
        count(*) FILTER (WHERE created_at >= $1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh') AS current,
        count(*) FILTER (WHERE created_at >= $3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'
          AND created_at < $1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh') AS previous,
        count(*) AS total FROM users
        WHERE role IN ('USER','MERCHANT') AND ($4='ALL' OR role=$4)
          AND created_at < $2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh' GROUP BY role`,
      [
        filters.startInstant,
        filters.nextDayInstant,
        previous.startInstant,
        filters.role || "ALL",
      ],
    );
    return rows;
  },

  async insertReportOutbox(pool, reportId, payload) {
    await pool.query(
      "INSERT INTO audit_outbox(id,event_type,payload) VALUES($1,$2,$3::jsonb)",
      [reportId, "ADMIN_FINANCIAL_REPORT_GENERATED", JSON.stringify(payload)],
    );
  },
};

module.exports = adminFinancialReportRepository;
