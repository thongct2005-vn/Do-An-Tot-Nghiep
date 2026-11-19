const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createTestDatabase } = require("./merchant_test_database");
const {
  DASHBOARD_ROLLUP_LOCK_KEY,
  REPORT_ROLLUP_LOCK_KEY,
  computeDashboardTargetCutoff,
  computeReportTargetCutoff,
  reconcileReportDays,
  runAnalyticsV2Backfill,
} = require("../scripts/backfill_analytics_v2");
const {
  V2_TRIGGERS,
  getV2TriggerStatus,
  disableV2Triggers,
  enableV2TriggersAndReconcile,
} = require("../scripts/emergency_v2_triggers");
const {
  getAnalyticsStorageMode,
  getAnalyticsRollupHealth,
} = require("../src/admin/analyticsStorage");
const defaultPool = require("../src/config/database");
const reportRollup = require("../src/admin/reports/reportRollup");
const dashboardRollup = require("../src/admin/dashboard/dashboardRollup");
const reportsService = require("../src/admin/reports/reports.service");
const financialReportRepo = require("../src/admin/reports/financialReport.repository");
const adminTxRepo = require("../src/admin/transaction/transaction.repository");

async function withAdvisoryRetry(fn, { maxRetries = 3, baseDelayMs = 20 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (err && (err.code === "40P01" || err.code === "55P03") && attempt < maxRetries) {
        attempt += 1;
        const jitter = Math.floor(Math.random() * 15);
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt + jitter));
        continue;
      }
      throw err;
    }
  }
}

async function reconcileReportV2(dbPool, { injectFailureBeforeCommit = false } = {}) {
  return withAdvisoryRetry(async () => {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [REPORT_ROLLUP_LOCK_KEY]);
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '30s'");

      const st = await client.query(
        `SELECT rollup_until FROM public.aggregation_rollup_state WHERE domain = 'report_merchant'`
      );
      const rollupUntil = st.rows[0]?.rollup_until;

      const popped = await client.query(`
        DELETE FROM public.aggregation_dirty_buckets
        WHERE domain = 'report_merchant'
        RETURNING bucket_ts, dirty_tx, dirty_fee
      `);
      const rows = popped.rows || [];
      if (rows.length > 0 && rollupUntil) {
        const txBuckets = rows.filter((r) => r.dirty_tx).map((r) => r.bucket_ts);
        const feeBuckets = rows.filter((r) => r.dirty_fee).map((r) => r.bucket_ts);

        const sortDates = async (arr) => {
          if (arr.length === 0) return [];
          const res = await client.query(
            `SELECT ARRAY(SELECT DISTINCT ((ts AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::text FROM unnest($1::timestamptz[]) ts ORDER BY 1 ASC) AS d`,
            [arr]
          );
          return res.rows[0]?.d || [];
        };

        const txDays = await sortDates(txBuckets);
        const feeDays = await sortDates(feeBuckets);

        if (txDays.length > 0) {
          await client.query(
            `UPDATE public.report_merchant_financial_daily SET tx_count = 0, tx_amount = 0, updated_at = NOW() WHERE bucket_day = ANY($1::date[])`,
            [txDays]
          );
          await client.query(
            `
            INSERT INTO public.report_merchant_financial_daily (bucket_day, merchant_id, transaction_type, tx_count, tx_amount, updated_at)
            SELECT (t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, u.id, t.transaction_type::text, COUNT(*)::bigint, COALESCE(SUM(t.amount), 0)::numeric(22,0), NOW()
            FROM unnest($1::date[]) d(bucket_day)
            JOIN public.transactions t ON t.created_at >= (d.bucket_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND t.created_at < ((d.bucket_day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
            JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
            WHERE t.created_at < $2 AND t.status IN ('SUCCESS', 'COMPLETED') AND t.transaction_type IN ('PAYMENT', 'TRANSFER') AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
            GROUP BY 1, 2, 3
            ON CONFLICT (bucket_day, merchant_id, transaction_type) DO UPDATE SET tx_count = EXCLUDED.tx_count, tx_amount = EXCLUDED.tx_amount, updated_at = NOW()
            `,
            [txDays, rollupUntil]
          );
        }

        if (feeDays.length > 0) {
          await client.query(
            `UPDATE public.report_merchant_financial_daily SET fee_amount = 0, fee_tx_count = 0, updated_at = NOW() WHERE bucket_day = ANY($1::date[])`,
            [feeDays]
          );
          await client.query(
            `
            INSERT INTO public.report_merchant_financial_daily (bucket_day, merchant_id, transaction_type, fee_amount, fee_tx_count, updated_at)
            SELECT (l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, u.id, t.transaction_type::text, COALESCE(SUM(l.amount), 0)::numeric(22,0), COUNT(*)::bigint, NOW()
            FROM unnest($1::date[]) d(bucket_day)
            JOIN public.fee_ledger_entries l ON l.created_at >= (d.bucket_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND l.created_at < ((d.bucket_day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
            JOIN public.transactions t ON t.id = l.transaction_id
            JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
            WHERE l.created_at < $2 AND l.fee_type = 'QR_FEE' AND l.transaction_id IS NOT NULL AND t.status IN ('SUCCESS', 'COMPLETED') AND t.transaction_type IN ('PAYMENT', 'TRANSFER') AND COALESCE(t.fee_rate_snapshot->>'operation_type', '') <> 'REVERSAL'
            GROUP BY 1, 2, 3
            ON CONFLICT (bucket_day, merchant_id, transaction_type) DO UPDATE SET fee_amount = EXCLUDED.fee_amount, fee_tx_count = EXCLUDED.fee_tx_count, updated_at = NOW()
            `,
            [feeDays, rollupUntil]
          );
        }

        const touched = [...new Set([...txDays, ...feeDays].map(String))].sort();
        if (touched.length > 0) {
          await client.query(
            `DELETE FROM public.report_merchant_financial_daily WHERE bucket_day = ANY($1::date[]) AND tx_count = 0 AND tx_amount = 0 AND fee_amount = 0 AND fee_tx_count = 0`,
            [touched]
          );
        }
      }

      if (injectFailureBeforeCommit) {
        throw new Error("SYNTHETIC_CRASH_BEFORE_COMMIT");
      }

      await client.query("COMMIT");
      return { reconciledBuckets: rows.length };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
}

async function reconcileDashV2(dbPool) {
  return withAdvisoryRetry(async () => {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [DASHBOARD_ROLLUP_LOCK_KEY]);
      await client.query("SET LOCAL lock_timeout = '3s'");

      const st = await client.query(
        `SELECT rollup_until FROM public.aggregation_rollup_state WHERE domain = 'dashboard'`
      );
      const rollupUntil = st.rows[0]?.rollup_until;
      const popped = await client.query(`
        WITH p AS (
          DELETE FROM public.aggregation_dirty_buckets WHERE domain = 'dashboard' RETURNING bucket_ts
        )
        SELECT ARRAY(SELECT DISTINCT bucket_ts FROM p ORDER BY 1 ASC) AS hours
      `);
      const hours = popped.rows[0]?.hours || [];
      if (hours.length > 0 && rollupUntil) {
        await client.query(
          `DELETE FROM public.dashboard_tx_hourly WHERE bucket_hour = ANY($1::timestamptz[])`,
          [hours]
        );
        await client.query(
          `
          INSERT INTO public.dashboard_tx_hourly (bucket_hour, transaction_type, status, tx_count, total_amount, updated_at)
          SELECT date_trunc('hour', t.created_at), t.transaction_type::text, t.status::text, COUNT(*)::bigint, COALESCE(SUM(t.amount), 0)::numeric(22,0), NOW()
          FROM unnest($1::timestamptz[]) d(bucket_hour)
          JOIN public.transactions t ON t.created_at >= d.bucket_hour AND t.created_at < d.bucket_hour + INTERVAL '1 hour'
          WHERE t.created_at < $2
          GROUP BY 1, 2, 3
          `,
          [hours, rollupUntil]
        );
      }
      await client.query("COMMIT");
      return { reconciledHours: hours.length };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
}

test("Analytics v2 Verification: Concurrent backfill, 2-domain watermarks, all 6 dirty bucket edge cases, and crash/retry", async (t) => {
  const target = await createTestDatabase();
  const testPool = new Pool({ ...target.config, max: 10 });

  const U_PAYER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
  const U_MERCH_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
  const U_MERCH_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
  const U_FEE_WALLET = "cccccccc-cccc-cccc-cccc-ccccccccccc1";

  try {
    await testPool.query(
      fs.readFileSync(path.join(__dirname, "../migrations/20261116_dashboard_tx_hourly_rollup.sql"), "utf8")
    );
    await testPool.query(
      fs.readFileSync(path.join(__dirname, "../migrations/20261129_additive_schema_v2_rollup.sql"), "utf8")
    );

    await testPool.query(`
      INSERT INTO public.users (id, role, full_name, phone, status) VALUES
        ('${U_PAYER}', 'USER', 'Payer', '0900000011', 'ACTIVE'),
        ('${U_MERCH_A}', 'MERCHANT', 'Merchant A', '0900000012', 'ACTIVE'),
        ('${U_MERCH_B}', 'MERCHANT', 'Merchant B', '0900000013', 'ACTIVE'),
        ('${U_FEE_WALLET}', 'ADMIN', 'Fee Wallet', '0900000014', 'ACTIVE')
    `);

    // Seed data across Nov 12..Nov 15 VN including cross-day fee ledger, 0-fee TRANSFER, boundary 23:59:59+07 & 00:00:00+07
    await testPool.query(`
      INSERT INTO public.transactions (id, transaction_type, source_user_id, destination_user_id, amount, merchant_fee, status, created_at) VALUES
        ('TX_D12_PAY', 'PAYMENT', '${U_PAYER}', '${U_MERCH_A}', 100000, 1000, 'SUCCESS', '2026-11-12T05:00:00.000Z'),
        ('TX_D13_XFER0', 'TRANSFER', '${U_PAYER}', '${U_MERCH_A}', 200000, 0, 'SUCCESS', '2026-11-13T10:00:00.000Z'),
        ('TX_BOUND_2359', 'PAYMENT', '${U_PAYER}', '${U_MERCH_A}', 300000, 3000, 'SUCCESS', '2026-11-14T16:59:59.900Z'),
        ('TX_BOUND_0000', 'PAYMENT', '${U_PAYER}', '${U_MERCH_B}', 400000, 4000, 'SUCCESS', '2026-11-14T17:00:00.000Z')
    `);
    await testPool.query(`
      INSERT INTO public.fee_ledger_entries (id, transaction_id, merchant_user_id, payer_user_id, fee_type, amount, fee_wallet_user_id, fee_wallet_balance_before, fee_wallet_balance_after, created_at) VALUES
        (gen_random_uuid(), 'TX_D12_PAY', '${U_MERCH_A}', '${U_PAYER}', 'QR_FEE', 1000, '${U_FEE_WALLET}', 0, 1000, '2026-11-12T05:00:00.000Z'),
        (gen_random_uuid(), 'TX_BOUND_2359', '${U_MERCH_A}', '${U_PAYER}', 'QR_FEE', 3000, '${U_FEE_WALLET}', 1000, 4000, '2026-11-14T16:59:59.900Z'),
        -- Cross-day fee: transaction TX_BOUND_0000 happened on Nov 15 VN (17:00Z Nov 14), fee recorded on Nov 16 VN!
        (gen_random_uuid(), 'TX_BOUND_0000', '${U_MERCH_B}', '${U_PAYER}', 'QR_FEE', 4000, '${U_FEE_WALLET}', 4000, 8000, '2026-11-16T02:00:00.000Z')
    `);

    await t.test("1. Separate domain watermarks + concurrent INSERT/UPDATE during backfill leave ZERO gaps", async () => {
      const dashCut = await computeDashboardTargetCutoff(testPool);
      const repCut = await computeReportTargetCutoff(testPool);
      assert.notEqual(dashCut.toISOString(), repCut.toISOString(), "dashboard UTC hour cutoff differs from report VN 00:00 cutoff");
      // Check report cutoff is strictly 00:00:00+07:00 -> 17:00:00.000Z
      assert.equal(repCut.toISOString().slice(11), "17:00:00.000Z");

      const simDashCut = new Date("2026-11-16T06:00:00.000Z");
      const simRepCut = new Date("2026-11-16T17:00:00.000Z"); // closed through 2026-11-16 VN

      // Start an OLTP tx BEFORE dirty_guard_until is set, delay slightly, verify XID drain + guard catches all mutations
      await runAnalyticsV2Backfill(testPool, {
        dashCutoff: simDashCut,
        reportCutoff: simRepCut,
        silent: true,
        onAfterChunk: async ({ chunkNo }) => {
          if (chunkNo === 1) {
            await testPool.query(`
              INSERT INTO public.transactions (id, transaction_type, source_user_id, destination_user_id, amount, merchant_fee, status, created_at)
              VALUES ('TX_CONC_MID', 'TRANSFER', '${U_PAYER}', '${U_MERCH_A}', 50000, 0, 'SUCCESS', '2026-11-13T12:00:00.000Z')
            `);
          }
        },
        beforeSeal: async () => {
          await testPool.query(`
            UPDATE public.transactions SET amount = 150000 WHERE id = 'TX_D12_PAY'
          `);
          await testPool.query(`
            INSERT INTO public.fee_ledger_entries (id, transaction_id, merchant_user_id, payer_user_id, fee_type, amount, fee_wallet_user_id, fee_wallet_balance_before, fee_wallet_balance_after, created_at)
            VALUES (gen_random_uuid(), 'TX_CONC_MID', '${U_MERCH_A}', '${U_PAYER}', 'QR_FEE', 250, '${U_FEE_WALLET}', 8000, 8250, '2026-11-13T12:00:00.000Z')
          `);
          await testPool.query(`
            UPDATE public.fee_ledger_entries SET amount = 1250 WHERE transaction_id = 'TX_D12_PAY' AND fee_type = 'QR_FEE'
          `);
        },
      });

      const rawNov12 = await testPool.query(`SELECT SUM(amount)::bigint AS amt, COUNT(*)::int AS cnt FROM public.transactions WHERE id = 'TX_D12_PAY'`);
      const rollNov12 = await testPool.query(`SELECT tx_amount::bigint AS amt, tx_count::int AS cnt, fee_amount::bigint AS fee, fee_tx_count::int AS fee_cnt FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-12' AND merchant_id = '${U_MERCH_A}'`);
      assert.equal(rollNov12.rows[0].amt, rawNov12.rows[0].amt);
      assert.equal(rollNov12.rows[0].fee, "1250");

      const rollNov13 = await testPool.query(`SELECT tx_count::int AS cnt, tx_amount::bigint AS amt, fee_amount::bigint AS fee, fee_tx_count::int AS fcnt FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-13' AND merchant_id = '${U_MERCH_A}' AND transaction_type = 'TRANSFER'`);
      assert.equal(rollNov13.rows[0].cnt, 2); // TX_D13_XFER0 + TX_CONC_MID
      assert.equal(rollNov13.rows[0].amt, "250000");
      assert.equal(rollNov13.rows[0].fee, "250");
      assert.equal(rollNov13.rows[0].fcnt, 1);

      // Verify VN boundary split: Nov 14 got TX_BOUND_2359, Nov 15 got TX_BOUND_0000 TX, Nov 16 got TX_BOUND_0000 FEE!
      const nov15 = await testPool.query(`SELECT tx_count::int, tx_amount::bigint, fee_amount::bigint, fee_tx_count::int FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-15' AND merchant_id = '${U_MERCH_B}'`);
      assert.deepEqual(nov15.rows[0], { tx_count: 1, tx_amount: "400000", fee_amount: "0", fee_tx_count: 0 });
      const nov16 = await testPool.query(`SELECT tx_count::int, tx_amount::bigint, fee_amount::bigint, fee_tx_count::int FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-16' AND merchant_id = '${U_MERCH_B}'`);
      assert.deepEqual(nov16.rows[0], { tx_count: 0, tx_amount: "0", fee_amount: "4000", fee_tx_count: 1 });
    });

    await t.test("2. Cross-day fee, changing status/merchant/type, and moving created_at between buckets", async () => {
      // Case A: Change TX_BOUND_0000 status SUCCESS -> FAILED (TX was Nov 15 VN, Fee is Nov 16 VN!)
      await testPool.query(`UPDATE public.transactions SET status = 'FAILED' WHERE id = 'TX_BOUND_0000'`);
      await reconcileReportV2(testPool);
      const nov15After = await testPool.query(`SELECT * FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-15' AND merchant_id = '${U_MERCH_B}'`);
      const nov16After = await testPool.query(`SELECT * FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-16' AND merchant_id = '${U_MERCH_B}'`);
      assert.equal(nov15After.rowCount, 0, "Zeroed row on Nov 15 removed when both tx and fee are 0");
      assert.equal(nov16After.rowCount, 0, "Cross-day fee on Nov 16 invalidated & removed when source tx FAILED");

      // Case B: Restore TX_BOUND_0000 to SUCCESS & change Merchant B -> Merchant A
      await testPool.query(`UPDATE public.transactions SET status = 'SUCCESS', destination_user_id = '${U_MERCH_A}' WHERE id = 'TX_BOUND_0000'`);
      await reconcileReportV2(testPool);
      const nov15MerchA = await testPool.query(`SELECT tx_count::int, tx_amount::bigint FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-15' AND merchant_id = '${U_MERCH_A}'`);
      const nov16MerchA = await testPool.query(`SELECT fee_amount::bigint, fee_tx_count::int FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-16' AND merchant_id = '${U_MERCH_A}'`);
      assert.deepEqual(nov15MerchA.rows[0], { tx_count: 1, tx_amount: "400000" });
      assert.deepEqual(nov16MerchA.rows[0], { fee_amount: "4000", fee_tx_count: 1 });

      // Case C: Move TX_D13_XFER0 created_at from Nov 13 VN -> Nov 12 VN (bucket migration)
      await testPool.query(`UPDATE public.transactions SET created_at = '2026-11-12T06:00:00.000Z' WHERE id = 'TX_D13_XFER0'`);
      await reconcileReportV2(testPool);
      const nov13Rem = await testPool.query(`SELECT tx_count::int, tx_amount::bigint FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-13' AND merchant_id = '${U_MERCH_A}'`);
      const nov12Xfer = await testPool.query(`SELECT tx_count::int, tx_amount::bigint, fee_amount::bigint FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-12' AND merchant_id = '${U_MERCH_A}' AND transaction_type = 'TRANSFER'`);
      assert.equal(nov13Rem.rows[0].tx_count, 1); // Only TX_CONC_MID remains
      assert.deepEqual(nov12Xfer.rows[0], { tx_count: 1, tx_amount: "200000", fee_amount: "0" });

      // Ensure TX_D12_PAY PAYMENT fee (1250) was NOT touched by TRANSFER/TX moves
      const nov12Pay = await testPool.query(`SELECT tx_count::int, tx_amount::bigint, fee_amount::bigint, fee_tx_count::int FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-12' AND merchant_id = '${U_MERCH_A}' AND transaction_type = 'PAYMENT'`);
      assert.deepEqual(nov12Pay.rows[0], { tx_count: 1, tx_amount: "150000", fee_amount: "1250", fee_tx_count: 1 });

      // Case D: Move fee_ledger_entries.created_at from Nov 16 VN -> Nov 15 VN & test transaction_type PAYMENT -> TRANSFER on TX_BOUND_0000
      await testPool.query(`UPDATE public.fee_ledger_entries SET created_at = '2026-11-15T05:00:00.000Z' WHERE transaction_id = 'TX_BOUND_0000' AND fee_type = 'QR_FEE'`);
      await testPool.query(`UPDATE public.transactions SET transaction_type = 'TRANSFER' WHERE id = 'TX_BOUND_0000'`);
      await reconcileReportV2(testPool);
      const nov16MovedEmpty = await testPool.query(`SELECT * FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-16' AND merchant_id = '${U_MERCH_A}'`);
      const nov15MovedXfer = await testPool.query(`SELECT tx_count::int, tx_amount::bigint, fee_amount::bigint, fee_tx_count::int FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-15' AND merchant_id = '${U_MERCH_A}' AND transaction_type = 'TRANSFER'`);
      assert.equal(nov16MovedEmpty.rowCount, 0);
      assert.deepEqual(nov15MovedXfer.rows[0], { tx_count: 1, tx_amount: "400000", fee_amount: "4000", fee_tx_count: 1 });
    });

    await t.test("2b. Watermark barrier waitForXidDrain waits for pre-guard in-flight transaction and catches concurrent writes during watermark advance", async () => {
      // Simulate clean pre-backfill state (-infinity): trigger inside inflightClient sees -infinity!
      await testPool.query(`UPDATE public.aggregation_rollup_state SET rollup_until = '-infinity'::timestamptz, dirty_guard_until = NULL`);

      const inflightClient = await testPool.connect();
      try {
        await inflightClient.query("BEGIN");
        // Acquire a real assigned XID prior to dirty_guard_until commit; trigger sees -infinity so writes no dirty row
        await inflightClient.query(`
          INSERT INTO public.transactions (id, transaction_type, source_user_id, destination_user_id, amount, merchant_fee, status, created_at)
          VALUES ('TX_INFLIGHT_PRE_GUARD', 'TRANSFER', '${U_PAYER}', '${U_MERCH_B}', 77000, 0, 'SUCCESS', '2026-11-13T08:00:00.000Z')
        `);
        const releaseLater = (async () => {
          await new Promise((r) => setTimeout(r, 400));
          await inflightClient.query("COMMIT");
        })();

        const summary = await runAnalyticsV2Backfill(testPool, {
          dashCutoff: new Date("2026-11-16T06:00:00.000Z"),
          reportCutoff: new Date("2026-11-16T17:00:00.000Z"),
          silent: true,
        });
        await releaseLater;
        assert.ok(summary.drainInfo.drained, "XID barrier waited until in-flight TX committed");
        assert.ok(summary.drainInfo.waitedMs >= 150, `Expected wait >= 150ms, got ${summary.drainInfo.waitedMs}ms`);

        const checkMerchB = await testPool.query(`SELECT tx_count::int, tx_amount::bigint FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-13' AND merchant_id = '${U_MERCH_B}'`);
        assert.deepEqual(checkMerchB.rows[0], { tx_count: 1, tx_amount: "77000" });

        // Also simulate advancing report watermark 1 VN day forward while concurrently inserting at 23:59:59+07 inside that advancing day!
        const advCutoff = new Date("2026-11-17T17:00:00.000Z"); // 2026-11-18 00:00+07 (adds Nov 17 VN)
        await testPool.query(
          `UPDATE public.aggregation_rollup_state SET dirty_guard_until = $1 WHERE domain = 'report_merchant'`,
          [advCutoff]
        );
        // Concurrent OLTP write at 2026-11-17 23:59:59.500+07 -> 2026-11-17T16:59:59.500Z AFTER guard armed
        await testPool.query(`
          INSERT INTO public.transactions (id, transaction_type, source_user_id, destination_user_id, amount, merchant_fee, status, created_at)
          VALUES ('TX_ADV_CONC_2359', 'PAYMENT', '${U_PAYER}', '${U_MERCH_B}', 99000, 0, 'SUCCESS', '2026-11-17T16:59:59.500Z')
        `);
        await reconcileReportDays(testPool, [new Date("2026-11-17T00:00:00.000Z")], advCutoff);
        await testPool.query(
          `UPDATE public.aggregation_rollup_state SET rollup_until = $1, dirty_guard_until = NULL WHERE domain = 'report_merchant'`,
          [advCutoff]
        );
        await reconcileReportV2(testPool);
        const nov17Adv = await testPool.query(`SELECT tx_count::int, tx_amount::bigint FROM public.report_merchant_financial_daily WHERE bucket_day = '2026-11-17' AND merchant_id = '${U_MERCH_B}'`);
        assert.deepEqual(nov17Adv.rows[0], { tx_count: 1, tx_amount: "99000" });
      } finally {
        inflightClient.release();
      }
    });

    await t.test("3. Concurrent trigger writes + Dashboard/Report parallel jobs + crash rollback & retry recovery", async () => {
      // Trigger dirty on BOTH domains, simulate crash before COMMIT on report_merchant, verify rollback restores dirty buckets
      await testPool.query(`UPDATE public.transactions SET amount = 175000 WHERE id = 'TX_D12_PAY'`);
      await assert.rejects(
        () => reconcileReportV2(testPool, { injectFailureBeforeCommit: true }),
        /SYNTHETIC_CRASH_BEFORE_COMMIT/
      );

      const dirtyAfterCrash = await testPool.query(
        `SELECT domain, dirty_tx, dirty_fee FROM public.aggregation_dirty_buckets ORDER BY domain`
      );
      assert.equal(dirtyAfterCrash.rows.some((r) => r.domain === "dashboard"), true);
      assert.equal(dirtyAfterCrash.rows.some((r) => r.domain === "report_merchant" && r.dirty_tx), true);

      // Run Dashboard reconcile & Report reconcile CONCURRENTLY while another OLTP update fires
      const [dashRes, repRes] = await Promise.all([
        reconcileDashV2(testPool),
        reconcileReportV2(testPool),
        testPool.query(`UPDATE public.transactions SET amount = 55000 WHERE id = 'TX_CONC_MID'`),
      ]);
      assert.ok(dashRes.reconciledHours >= 1);
      assert.ok(repRes.reconciledBuckets >= 1);

      // Reconcile any newly generated dirty buckets after parallel OLTP update
      await Promise.all([reconcileDashV2(testPool), reconcileReportV2(testPool)]);

      const finalRoll = await testPool.query(`SELECT SUM(tx_amount)::bigint AS amt, SUM(fee_amount)::bigint AS fee FROM public.report_merchant_financial_daily`);
      const finalRawAmt = await testPool.query(`SELECT SUM(amount)::bigint AS amt FROM public.transactions WHERE status = 'SUCCESS' AND transaction_type IN ('PAYMENT','TRANSFER')`);
      const finalRawFee = await testPool.query(`SELECT SUM(l.amount)::bigint AS fee FROM public.fee_ledger_entries l JOIN public.transactions t ON t.id = l.transaction_id WHERE l.fee_type='QR_FEE' AND t.status='SUCCESS'`);
      assert.equal(finalRoll.rows[0].amt, finalRawAmt.rows[0].amt);
      assert.equal(finalRoll.rows[0].fee, finalRawFee.rows[0].fee);

      // Test retry wrapper recovers on synthetic 40P01 / 55P03
      let calls = 0;
      const retryOut = await withAdvisoryRetry(async () => {
        calls += 1;
        if (calls === 1) {
          const e = new Error("deadlock detected");
          e.code = "40P01";
          throw e;
        }
        return "RECOVERED";
      }, { maxRetries: 3, baseDelayMs: 5 });
      assert.equal(retryOut, "RECOVERED");
      assert.equal(calls, 2);
    });

    await t.test("4. Emergency Trigger v2 Disable, 55P03 Lock Timeout Handling, and Post-Recovery Gap Reconcile", async () => {
      // Attach v1 triggers alongside v2 to verify disabling *_v2 NEVER touches v1 triggers or constraints
      await testPool.query(
        fs.readFileSync(path.join(__dirname, "../migrations/20261124_report_hybrid_rollup.sql"), "utf8")
      );

      // Lock contention test: hold conflicting table lock in another client, verify short lock_timeout triggers 55P03
      const lockHolder = await testPool.connect();
      try {
        await lockHolder.query("BEGIN");
        await lockHolder.query("LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE");
        await assert.rejects(
          () => disableV2Triggers(testPool, { maxRetries: 1, lockTimeoutMs: 120, retryDelayMs: 40 }),
          (err) => err && /TRIGGER_V2_LOCK_TIMEOUT/.test(err.message) && err.code === "55P03"
        );
        await lockHolder.query("ROLLBACK");
      } finally {
        lockHolder.release();
      }

      // Now disable ONLY the 7 *_v2 triggers cleanly
      const disRes = await disableV2Triggers(testPool);
      assert.equal(disRes.status.disabledCount, V2_TRIGGERS.length);
      assert.equal(disRes.status.enabledCount, 0);
      assert.ok(disRes.status.pausedAt, "triggers_paused_at timestamp must be recorded");

      // Assert v1 triggers remain enabled ('O') and untouched
      const v1Check = await testPool.query(`
        SELECT tgname, tgenabled::text AS mode
        FROM pg_trigger tr
        JOIN pg_class c ON c.oid = tr.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT tr.tgisinternal
          AND tgname IN ('trg_transactions_dashboard_dirty', 'trg_tx_report_dirty_ins', 'trg_fee_ledger_report_dirty_ins')
      `);
      assert.equal(v1Check.rowCount, 3);
      assert.ok(v1Check.rows.every((r) => r.mode === "O"));

      // Health check detects disabled v2 triggers while paused
      const degradedHealth = await getAnalyticsRollupHealth(testPool, { modeOverride: "v2" });
      assert.equal(degradedHealth.healthy, false);
      assert.equal(degradedHealth.status, "degraded");
      assert.equal(degradedHealth.disabledTriggers.length, 7);

      // Simulate historical mutations occurring while Trigger v2 is paused
      await testPool.query(`
        INSERT INTO public.transactions (id, transaction_type, source_user_id, destination_user_id, amount, merchant_fee, status, created_at)
        VALUES ('TX_WHILE_PAUSED', 'PAYMENT', '${U_PAYER}', '${U_MERCH_A}', 250000, 2500, 'SUCCESS', '2026-11-12T10:00:00Z')
      `);
      await testPool.query(`
        INSERT INTO public.fee_ledger_entries (id, transaction_id, merchant_user_id, payer_user_id, fee_type, amount, fee_wallet_user_id, fee_wallet_balance_before, fee_wallet_balance_after, created_at)
        VALUES (gen_random_uuid(), 'TX_WHILE_PAUSED', '${U_MERCH_A}', '${U_PAYER}', 'QR_FEE', 2500, '${U_FEE_WALLET}', 9000, 11500, '2026-11-12T10:00:00Z')
      `);
      // Dirty table did NOT catch TX_WHILE_PAUSED while disabled
      const dirtyDuringPause = await testPool.query(`SELECT COUNT(*)::int AS cnt FROM public.aggregation_dirty_buckets`);
      assert.equal(dirtyDuringPause.rows[0].cnt, 0);

      // Re-enable Trigger v2 + backfill/reconcile full unmonitored gap
      const recRes = await enableV2TriggersAndReconcile(testPool, {
        dashCutoff: new Date("2026-11-18T00:00:00.000Z"),
        reportCutoff: new Date("2026-11-17T17:00:00.000Z"),
        silent: true,
      });
      assert.equal(recRes.status.enabledCount, 7);
      assert.equal(recRes.status.disabledCount, 0);
      assert.equal(recRes.status.pausedAt, null);

      const recoveredHealth = await getAnalyticsRollupHealth(testPool, { modeOverride: "v2" });
      assert.equal(recoveredHealth.healthy, true);

      // Confirm 100% of data inserted during pause is now reconciled into report_merchant_financial_daily & dashboard_tx_hourly
      const rollAmt = await testPool.query(`SELECT SUM(tx_amount)::bigint AS amt, SUM(fee_amount)::bigint AS fee FROM public.report_merchant_financial_daily`);
      const rawAmt = await testPool.query(`SELECT SUM(amount)::bigint AS amt FROM public.transactions WHERE status = 'SUCCESS' AND transaction_type IN ('PAYMENT','TRANSFER')`);
      const rawFee = await testPool.query(`SELECT SUM(l.amount)::bigint AS fee FROM public.fee_ledger_entries l JOIN public.transactions t ON t.id = l.transaction_id WHERE l.fee_type='QR_FEE' AND t.status='SUCCESS'`);
      assert.equal(rollAmt.rows[0].amt, rawAmt.rows[0].amt);
      assert.equal(rollAmt.rows[0].fee, rawFee.rows[0].fee);
    });

    await t.test("5. Feature Flag (v1 default / v2 / raw), Controlled 42P01, and Health Check", async () => {
      const savedMode = process.env.ANALYTICS_STORAGE_MODE;
      const savedFallback = process.env.ALLOW_MISSING_ROLLUP_FALLBACK;
      try {
        delete process.env.ANALYTICS_STORAGE_MODE;
        assert.equal(getAnalyticsStorageMode(), "v1", "Default pre-cutover mode must stay v1");
        assert.throws(() => getAnalyticsStorageMode({ ANALYTICS_STORAGE_MODE: "invalid" }), /Invalid ANALYTICS_STORAGE_MODE/);

        // Initialize v1 tables cleanly on same DB & verify v1, v2, and raw yield IDENTICAL JSON outputs
        await testPool.query(`UPDATE public.report_rollup_state SET rollup_until = '2026-11-01T00:00:00+07:00' WHERE id = 1`);
        await testPool.query(`UPDATE public.dashboard_rollup_state SET rollup_until = '2026-11-01T00:00:00+07:00' WHERE id = 1`);

        process.env.ANALYTICS_STORAGE_MODE = "v1";
        await dashboardRollup.advanceRollupCutoff(testPool);
        await reportRollup.advanceReportRollupCutoff(testPool);

        const qInput = { start_date: "2026-11-10", end_date: "2026-11-18", group_by: "day" };
        const resV1 = await reportsService.report(qInput, { db: testPool });
        const growthV1 = await reportsService.growth(qInput, { db: testPool });

        process.env.ANALYTICS_STORAGE_MODE = "v2";
        const resV2 = await reportsService.report(qInput, { db: testPool });
        const growthV2 = await reportsService.growth(qInput, { db: testPool });
        const finV2 = await financialReportRepo.readFinancialData(testPool, reportsService.filters(qInput));

        process.env.ANALYTICS_STORAGE_MODE = "raw";
        const resRaw = await reportsService.report(qInput, { db: testPool });
        const growthRaw = await reportsService.growth(qInput, { db: testPool });
        const finRaw = await financialReportRepo.readFinancialData(testPool, reportsService.filters(qInput));

        assert.deepEqual(resV2, resV1);
        assert.deepEqual(resV2, resRaw);
        assert.deepEqual(growthV2, growthV1);
        assert.deepEqual(growthV2, growthRaw);
        assert.deepEqual(finV2.merchant, finRaw.merchant);
        assert.deepEqual(finV2.merchant_fee_series, finRaw.merchant_fee_series);

        // Verify dirty backlog warning in health check
        await testPool.query(`
          INSERT INTO public.aggregation_dirty_buckets (domain, bucket_ts, dirty_tx, marked_at)
          VALUES ('report_merchant', '2026-11-12T00:00:00+07:00', true, NOW() - INTERVAL '10 minutes')
          ON CONFLICT (domain, bucket_ts) DO UPDATE SET marked_at = NOW() - INTERVAL '10 minutes'
        `);
        const lagHealth = await getAnalyticsRollupHealth(testPool, { modeOverride: "v2" });
        assert.equal(lagHealth.healthy, false);
        assert.ok(lagHealth.warnings.some((w) => w.startsWith("DIRTY_BACKLOG_REPORT_MERCHANT")));
        await testPool.query(`DELETE FROM public.aggregation_dirty_buckets WHERE domain = 'report_merchant'`);

        // Verify strict 42P01 behavior when ALLOW_MISSING_ROLLUP_FALLBACK=false (production safety)
        const fakeMissingPool = {
          async query() {
            const err = new Error('relation "public.aggregation_rollup_state" does not exist');
            err.code = "42P01";
            throw err;
          },
          async connect() {
            throw Object.assign(new Error('relation "public.aggregation_rollup_state" does not exist'), { code: "42P01" });
          },
        };

        process.env.ANALYTICS_STORAGE_MODE = "v2";
        process.env.ALLOW_MISSING_ROLLUP_FALLBACK = "false";
        const errLogs = [];
        const origErr = console.error;
        console.error = (...a) => errLogs.push(a.join(" "));
        try {
          await assert.rejects(
            () => reportsService.report(qInput, { db: fakeMissingPool }),
            (e) => e && e.statusCode === 503
          );
          await assert.rejects(
            () => dashboardRollup.getRollupState(fakeMissingPool),
            (e) => e && e.statusCode === 503
          );
        } finally {
          console.error = origErr;
        }
        assert.ok(errLogs.some((l) => l.includes("[ANALYTICS_ROLLUP_42P01]")));

        // Verify controlled 42P01 fallback succeeds cleanly when ALLOW_MISSING_ROLLUP_FALLBACK=true
        process.env.ALLOW_MISSING_ROLLUP_FALLBACK = "true";
        const warnLogs = [];
        const origWarn = console.warn;
        console.warn = (...a) => warnLogs.push(a.join(" "));
        try {
          const fallbackState = await dashboardRollup.getRollupState(fakeMissingPool);
          assert.equal(fallbackState.rollupUntil, null);
        } finally {
          console.warn = origWarn;
        }
        assert.ok(warnLogs.some((l) => l.includes("[ANALYTICS_ROLLUP_42P01]")));
      } finally {
        if (savedMode === undefined) delete process.env.ANALYTICS_STORAGE_MODE;
        else process.env.ANALYTICS_STORAGE_MODE = savedMode;
        if (savedFallback === undefined) delete process.env.ALLOW_MISSING_ROLLUP_FALLBACK;
        else process.env.ALLOW_MISSING_ROLLUP_FALLBACK = savedFallback;
      }
    });
  } finally {
    await testPool.end();
    await defaultPool.end().catch(() => {});
    await target.cleanup();
  }
});
