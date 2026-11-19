const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createTestDatabase } = require("./merchant_test_database");

test("reportRollup integration: parity after historical PENDING -> SUCCESS and cross-hour fee ledger updates", async (t) => {
  const target = await createTestDatabase();
  const pool = require("../src/config/database");
  const reports = require("../src/admin/reports/reports.service");
  const reportRollup = require("../src/admin/reports/reportRollup");

  try {
    await t.test("unit checks: selective dirty-hour repair and 42P01 fallback", async () => {
      const executed = [];
      const fakeClient = {
        released: false,
        async query(sql, params) {
          executed.push({ sql: sql.trim(), params });
          if (sql.includes("FROM public.report_rollup_state")) {
            return {
              rows: [
                {
                  rollup_until: new Date("2026-11-15T17:00:00.000Z"),
                  is_finite: true,
                },
              ],
            };
          }
          if (sql.includes("DELETE FROM public.report_dirty_hours")) {
            return {
              rows: [
                {
                  bucket_hour: new Date("2026-11-10T02:00:00.000Z"),
                  dirty_fee: true,
                  dirty_tx: false,
                  dirty_gateway: true,
                },
              ],
            };
          }
          return { rows: [], rowCount: 1 };
        },
        release() {
          this.released = true;
        },
      };

      const result = await reportRollup.reconcileReportDirtyHours({
        async connect() {
          return fakeClient;
        },
      });

      assert.equal(result.reconciledHours, 1);
      assert.deepEqual(result.reconciledDomains, { fee: 1, tx: 0, gateway: 1 });
      assert.equal(fakeClient.released, true);

      const sqlAll = executed.map((e) => e.sql).join("\n");
      assert.match(sqlAll, /pg_advisory_xact_lock/);
      assert.match(sqlAll, /INSERT INTO public\.report_merchant_fee_hourly/);
      assert.match(sqlAll, /INSERT INTO public\.report_gateway_hourly/);
      assert.doesNotMatch(sqlAll, /INSERT INTO public\.report_merchant_tx_hourly/);

      const missingErr = () => {
        const e = new Error('relation "public.report_rollup_state" does not exist');
        e.code = "42P01";
        return e;
      };

      const rollupUntil = await reportRollup.ensureReportRollupConsistent({
        async query() {
          throw missingErr();
        },
      });
      assert.equal(rollupUntil, null);

      let rolledBack = false;
      let released = false;
      const adv = await reportRollup.advanceReportRollupCutoff({
        async connect() {
          return {
            async query(sql) {
              if (sql.includes("ROLLBACK")) rolledBack = true;
              if (sql.includes("FROM public.report_rollup_state")) throw missingErr();
              return { rows: [] };
            },
            release() {
              released = true;
            },
          };
        },
      });
      assert.equal(adv.skippedMissingSchema, true);
      assert.equal(adv.rollupUntil, null);
      assert.equal(rolledBack, true);
      assert.equal(released, true);
    });

    const m1 = randomUUID();
    const m2 = randomUUID();
    const user = randomUUID();
    const wallet = "00000000-0000-7000-8000-000000000001";

    await pool.query(
      "INSERT INTO users(id, role, full_name, created_at) VALUES ($1,'MERCHANT','Merchant 1','2026-10-01'),($2,'MERCHANT','Merchant 2','2026-10-01'),($3,'USER','Customer','2026-10-01')",
      [m1, m2, user],
    );

    const txSuccess = randomUUID();
    const txPending = randomUUID();
    const txCrossHour = randomUUID();

    await pool.query(
      `INSERT INTO transactions(id, source_user_id, destination_user_id, transaction_type, status, amount, merchant_fee, created_at)
       VALUES
         ($1, $4, $5, 'PAYMENT', 'SUCCESS', 500000, 6000, '2026-11-10T05:10:00+07:00'),
         ($2, $4, $5, 'PAYMENT', 'PENDING', 200000, 2400, '2026-11-10T05:20:00+07:00'),
         ($3, $4, $6, 'TRANSFER', 'PENDING', 300000, 3000, '2026-11-10T04:00:00+07:00')`,
      [txSuccess, txPending, txCrossHour, user, m1, m2],
    );

    await pool.query(
      `INSERT INTO fee_ledger_entries(id, transaction_id, merchant_user_id, fee_type, amount, fee_wallet_user_id, fee_wallet_balance_before, fee_wallet_balance_after, created_at)
       VALUES
         ($1, $4, $7, 'QR_FEE', 6000, $9, 0, 6000, '2026-11-10T05:10:00+07:00'),
         ($2, $5, $7, 'QR_FEE', 2400, $9, 0, 2400, '2026-11-10T05:20:00+07:00'),
         ($3, $6, $8, 'QR_FEE', 3000, $9, 0, 3000, '2026-11-12T10:15:00+07:00')`,
      [randomUUID(), randomUUID(), randomUUID(), txSuccess, txPending, txCrossHour, m1, m2, wallet],
    );

    const prId = randomUUID();
    await pool.query(
      `INSERT INTO payment_requests(id, destination_user_id, status, order_id, created_at)
       VALUES
         ($1, $2, 'PENDING', 'ord-1', '2026-11-10T08:00:00+07:00'),
         ($3, $2, 'SUCCESS', NULL, '2026-11-10T08:00:00+07:00')`,
      [prId, m1, randomUUID()],
    );

    await t.test("works safely without report_*_hourly tables (42P01 fallback)", async () => {
      const f = reports.filters({ start_date: "2026-11-09", end_date: "2026-11-30" });
      const rollupUntil = await reportRollup.ensureReportRollupConsistent(pool);
      assert.equal(rollupUntil, null);

      const fallbackFull = await reportRollup.queryReportFull(pool, f, rollupUntil);
      const fallbackRev = await reportRollup.queryFeeRevenueSummary(pool, f, rollupUntil);
      assert.equal(fallbackRev, 6000);
      assert.equal(fallbackFull.overview.revenue, 6000);
      assert.equal(fallbackFull.overview.gross, 500000);
    });

    await t.test("parity after historical PENDING -> SUCCESS and cross-hour fee ledger updates", async () => {
      const ddl = fs.readFileSync(
        path.join(__dirname, "../migrations/20261124_report_hybrid_rollup.sql"),
        "utf8",
      );
      await pool.query(ddl);

      await pool.query(
        `UPDATE public.report_rollup_state SET rollup_until = '2026-11-01T00:00:00+07:00' WHERE id = 1`,
      );
      const adv = await reportRollup.advanceReportRollupCutoff(pool);
      assert.ok(adv.rolledUpRows >= 3);

      await pool.query(`UPDATE public.transactions SET status = 'SUCCESS' WHERE id = $1`, [txPending]);
      await pool.query(`UPDATE public.transactions SET status = 'SUCCESS' WHERE id = $1`, [txCrossHour]);
      await pool.query(`UPDATE public.payment_requests SET status = 'EXPIRED' WHERE id = $1`, [prId]);

      const dirtyBefore = await pool.query(`SELECT COUNT(*)::int AS cnt FROM public.report_dirty_hours`);
      assert.ok(dirtyBefore.rows[0].cnt >= 2, "Triggers must record dirty hours for tx, cross-hour fee, and gateway");

      const f = reports.filters({ start_date: "2026-11-09", end_date: "2026-11-30" });
      const rollupUntil = await reportRollup.ensureReportRollupConsistent(pool);

      const dirtyAfter = await pool.query(`SELECT COUNT(*)::int AS cnt FROM public.report_dirty_hours`);
      assert.equal(dirtyAfter.rows[0].cnt, 0, "Dirty hours must be drained cleanly after consistent check");

      const raw = (
        await pool.query(reports.REPORT_SQL, [f.startInstant, f.nextDayInstant, null, null, f.group, 20, 0])
      ).rows[0].data;
      const hybrid = await reportRollup.queryReportFull(pool, f, rollupUntil);
      const kpiRev = await reportRollup.queryFeeRevenueSummary(pool, f, rollupUntil);
      const merchantsPage = await reportRollup.queryMerchantsPage(pool, f, rollupUntil);

      assert.equal(kpiRev, 11400);
      assert.deepEqual(hybrid.overview, raw.overview);
      assert.deepEqual(hybrid.breakdown, raw.breakdown);
      assert.deepEqual(hybrid.timeseries, raw.timeseries);
      assert.deepEqual(hybrid.merchants, raw.merchants);
      assert.equal(Number(hybrid.total_merchants), Number(raw.total_merchants));
      assert.deepEqual(hybrid.gateway, raw.gateway);
      assert.deepEqual(merchantsPage.merchants, raw.merchants);
      assert.equal(merchantsPage.total_merchants, Number(raw.total_merchants));

      // Also verify growth() reuses dashboard_tx_hourly identically when available
      const dashDdl = fs.readFileSync(
        path.join(__dirname, "../migrations/20261116_dashboard_tx_hourly_rollup.sql"),
        "utf8",
      );
      await pool.query(dashDdl);
      await pool.query(
        `UPDATE public.dashboard_rollup_state SET rollup_until = '2026-11-01T00:00:00+07:00' WHERE id = 1`,
      );
      const { advanceRollupCutoff } = require("../src/admin/dashboard/dashboardRollup");
      await advanceRollupCutoff(pool);

      const gAll = await reports.growth({ start_date: "2026-11-09", end_date: "2026-11-15" });
      assert.equal(gAll.transactions.current_count, 3);
      assert.equal(gAll.transactions.current_gross, 1000000);
      const gMerchant = await reports.growth({ start_date: "2026-11-09", end_date: "2026-11-15", merchant_id: m1 });
      assert.equal(gMerchant.transactions.current_count, 2);
      assert.equal(gMerchant.transactions.current_gross, 700000);
    });
  } finally {
    await pool.end();
    await target.cleanup();
  }
});
