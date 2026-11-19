const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../src/config/database");
const adminDashboardRepository = require("../src/admin/dashboard/dashboard.repository");
const adminDashboardService = require("../src/admin/dashboard/dashboard.service");
const dashboardRollup = require("../src/admin/dashboard/dashboardRollup");

describe("Admin Dashboard Hybrid Rollup Repository Tests", () => {
  const originalPoolQuery = pool.query.bind(pool);
  const originalPoolConnect = pool.connect.bind(pool);

  afterEach(() => {
    pool.query = originalPoolQuery;
    pool.connect = originalPoolConnect;
  });

  it("computeHybridWindow chia chính xác khoảng [start, split) cho rollup và [split, next) cho transactions", () => {
    const start = "2025-12-31T17:00:00.000Z"; // 2026-01-01 00:00+07
    const rollup = "2026-11-13T17:00:00.000Z"; // 2026-11-14 00:00+07
    const next = "2026-11-14T17:00:00.000Z"; // 2026-11-15 00:00+07

    const ytd = dashboardRollup.computeHybridWindow(start, next, rollup);
    assert.equal(ytd.useRollup, true);
    assert.equal(ytd.useTail, true);
    assert.equal(ytd.splitInstant.toISOString(), rollup);

    const todayOnly = dashboardRollup.computeHybridWindow(rollup, next, rollup);
    assert.equal(todayOnly.useRollup, false);
    assert.equal(todayOnly.useTail, true);
    assert.equal(todayOnly.splitInstant.toISOString(), rollup);

    const pastOnly = dashboardRollup.computeHybridWindow(
      start,
      "2026-10-31T17:00:00.000Z",
      rollup
    );
    assert.equal(pastOnly.useRollup, true);
    assert.equal(pastOnly.useTail, false);
    assert.equal(pastOnly.splitInstant.toISOString(), "2026-10-31T17:00:00.000Z");

    const unbackfilled = dashboardRollup.computeHybridWindow(start, next, null);
    assert.equal(unbackfilled.useRollup, false);
    assert.equal(unbackfilled.useTail, true);
  });

  it("reconcileDirtyHours đối soát lại các giờ dirty dưới pg_advisory_xact_lock khi có PENDING -> FAILED ở quá khứ", async () => {
    const executed = [];
    const fakeClient = {
      released: false,
      async query(sql, params) {
        executed.push({ sql: sql.trim(), params });
        if (sql.includes("FROM public.dashboard_rollup_state")) {
          return {
            rows: [
              {
                rollup_until: new Date("2026-11-13T17:00:00.000Z"),
                is_finite: true,
              },
            ],
          };
        }
        if (sql.includes("DELETE FROM public.dashboard_dirty_hours")) {
          return {
            rows: [{ hours: [new Date("2026-11-10T02:00:00.000Z")] }],
          };
        }
        return { rows: [], rowCount: 2 };
      },
      release() {
        this.released = true;
      },
    };

    const fakePool = {
      async connect() {
        return fakeClient;
      },
    };

    const result = await dashboardRollup.reconcileDirtyHours(fakePool);
    assert.equal(result.reconciledHours, 1);
    assert.equal(fakeClient.released, true);

    const sqlText = executed.map((e) => e.sql).join("\n");
    assert.match(sqlText, /BEGIN/);
    assert.match(sqlText, /pg_advisory_xact_lock/);
    assert.match(sqlText, /DELETE FROM public\.dashboard_dirty_hours/);
    assert.match(sqlText, /DELETE FROM public\.dashboard_tx_hourly/);
    assert.match(sqlText, /INSERT INTO public\.dashboard_tx_hourly/);
    assert.match(sqlText, /COMMIT/);
  });

  it("kỳ Năm nay (Hybrid rollup + today tail) dùng DATE_TRUNC không sort rời rạc và trả kết quả chuẩn qua service", async () => {
    const rollupUntil = new Date("2026-11-13T17:00:00.000Z");
    const captured = [];

    pool.query = async (sql, params) => {
      captured.push({ sql, params });
      if (sql.includes("FROM public.dashboard_rollup_state")) {
        return {
          rows: [
            {
              rollup_until: rollupUntil,
              is_finite: true,
              has_dirty: false,
            },
          ],
        };
      }
      if (sql.includes("AS total_transactions")) {
        return {
          rows: [
            {
              total_transactions: 8451500,
              total_topup: "1200000000",
              total_withdraw: "400000000",
              total_qr_payment: "300000000",
              total_transfer: "100000000",
            },
          ],
        };
      }
      if (sql.includes("AS completed_count") && sql.includes("transaction_type")) {
        return {
          rows: [
            {
              transaction_type: "PAYMENT",
              total_count: 100,
              completed_count: 95,
              pending_count: 2,
              failed_count: 3,
            },
          ],
        };
      }
      if (sql.includes("FROM public.fee_ledger_entries")) {
        return {
          rows: [
            {
              total_revenue: "60000",
              service_fee_revenue: "40000",
              late_fee_revenue: "20000",
              fee_tx_count: 3,
            },
          ],
        };
      }
      if (sql.includes("AS qr_payment")) {
        return {
          rows: [
            {
              bucket_key: "2026-11",
              topup: "50000000",
              withdraw: "20000000",
              qr_payment: "15000000",
            },
          ],
        };
      }
      return {
        rows: [
          {
            bucket_key: "2026-11",
            count: 50,
            completed_count: 45,
            pending_count: 2,
            failed_count: 3,
          },
        ],
      };
    };

    const overview = await adminDashboardService.getOverview({
      start_date: "2026-01-01",
      end_date: "2026-11-14",
    });
    assert.equal(
      captured.filter((c) => c.sql.includes("FROM public.dashboard_rollup_state")).length,
      1,
      "getOverview chỉ được phép gọi kiểm tra rollup state tối đa 1 lần (single-flight)",
    );
    assert.equal(overview.kpis.total_transactions, 8451500);
    assert.equal(overview.kpis.net_cashflow, 800000000);
    assert.deepEqual(overview.postpaid_revenue, {
      total_revenue: 60000,
      service_fee_revenue: 40000,
      late_fee_revenue: 20000,
      fee_tx_count: 3,
    });
    const paymentStatus = overview.status_distribution.find(
      (s) => s.type === "PAYMENT"
    );
    assert.equal(paymentStatus.failed_count, 3);
    assert.equal(paymentStatus.pending_count, 2);

    const [cashflow, volume] = await Promise.all([
      adminDashboardService.getCashflow({
        start_date: "2026-01-01",
        end_date: "2026-11-14",
      }),
      adminDashboardService.getTransactionVolume({
        start_date: "2026-01-01",
        end_date: "2026-11-14",
      }),
    ]);

    assert.equal(cashflow.buckets.length, 11);
    assert.equal(volume.buckets.length, 11);
    assert.equal(cashflow.buckets[10].label, "T11/2026");
    assert.equal(cashflow.buckets[10].topup, 50000000);
    assert.equal(volume.buckets[10].failed_count, 3);

    const cashflowSql = captured.find((c) => c.sql.includes("AS qr_payment")).sql;
    assert.match(cashflowSql, /FROM public\.dashboard_tx_hourly/);
    assert.match(cashflowSql, /FROM public\.transactions/);
    assert.match(cashflowSql, /DATE_TRUNC\('month'/);
    assert.match(cashflowSql, /GROUP BY bucket_ts\s+ORDER BY bucket_ts ASC/);
  });

  it("an toàn fallback về raw transactions nếu bảng dashboard_rollup_state chưa tồn tại (42P01)", async () => {
    const queries = [];
    pool.query = async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("FROM public.dashboard_rollup_state")) {
        const err = new Error('relation "public.dashboard_rollup_state" does not exist');
        err.code = "42P01";
        throw err;
      }
      return {
        rows: [
          {
            total_transactions: 12,
            total_topup: "1000",
            total_withdraw: "0",
            total_qr_payment: "0",
            total_transfer: "0",
          },
        ],
      };
    };

    const summary = await adminDashboardRepository.getKpiSummary(
      new Date("2026-11-13T17:00:00.000Z"),
      new Date("2026-11-14T17:00:00.000Z")
    );
    assert.equal(summary.total_transactions, 12);
    const dataQuery = queries[1];
    assert.doesNotMatch(dataQuery.sql, /dashboard_tx_hourly/);
    assert.match(dataQuery.sql, /FROM public\.transactions/);
  });

  it("getPostpaidRevenueSummary fallback về 0 khi bảng fee_ledger_entries chưa tồn tại (42P01)", async () => {
    pool.query = async () => {
      const err = new Error('relation "public.fee_ledger_entries" does not exist');
      err.code = "42P01";
      throw err;
    };

    const postpaid = await adminDashboardRepository.getPostpaidRevenueSummary(
      new Date("2026-11-13T17:00:00.000Z"),
      new Date("2026-11-14T17:00:00.000Z")
    );
    assert.deepEqual(postpaid, {
      total_revenue: 0,
      service_fee_revenue: 0,
      late_fee_revenue: 0,
      fee_tx_count: 0,
    });
  });
});
