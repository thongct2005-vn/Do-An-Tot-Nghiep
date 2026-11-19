const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const dashboardRollupJob = require("../src/jobs/dashboardRollup.job");
const dashboardRollup = require("../src/admin/dashboard/dashboardRollup");

describe("Dashboard Rollup Background Job Tests", () => {
  it("tick() đối soát dirty hours và cuộn rollup_until sang target cutoff, an toàn khi chạy lặp liên tiếp", async () => {
    const queries = [];
    let currentRollupUntil = new Date("2026-11-12T17:00:00.000Z");
    const targetCutoff = new Date("2026-11-13T17:00:00.000Z");

    const fakeClient = {
      async query(sql, params) {
        queries.push({ sql: sql.trim(), params });
        if (sql.includes("FROM public.dashboard_rollup_state") && sql.includes("target_cutoff")) {
          return {
            rows: [
              {
                rollup_until: currentRollupUntil,
                is_finite: true,
                target_cutoff: targetCutoff,
                next_cutoff: targetCutoff,
              },
            ],
          };
        }
        if (sql.includes("FROM public.dashboard_rollup_state")) {
          return { rows: [{ rollup_until: currentRollupUntil, is_finite: true }] };
        }
        if (sql.includes("DELETE FROM public.dashboard_dirty_hours") && sql.includes("ARRAY_AGG")) {
          return { rows: [{ hours: null }] };
        }
        if (sql.includes("INSERT INTO public.dashboard_tx_hourly")) {
          return { rows: [], rowCount: 48 };
        }
        if (sql.includes("UPDATE public.dashboard_rollup_state")) {
          currentRollupUntil = params[0];
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };

    const fakeDb = {
      async connect() {
        return fakeClient;
      },
    };

    const first = await dashboardRollupJob.tick({ db: fakeDb });
    assert.equal(first.skipped, false);
    assert.equal(first.rolledUpRows, 48);
    assert.equal(first.rollupUntil.toISOString(), targetCutoff.toISOString());

    // Chạy lặp lại lần 2 khi rollup_until đã bằng targetCutoff -> idempotent (0 rows)
    const second = await dashboardRollupJob.tick({ db: fakeDb });
    assert.equal(second.skipped, false);
    assert.equal(second.rolledUpRows, 0);
    assert.equal(second.rollupUntil.toISOString(), targetCutoff.toISOString());

    const sqlText = queries.map((q) => q.sql).join("\n");
    assert.match(sqlText, /pg_advisory_xact_lock/);
    assert.match(sqlText, /SET LOCAL work_mem = '64MB'/);
    assert.match(sqlText, /UPDATE public\.dashboard_rollup_state/);
  });

  it("tick() bỏ qua lần gọi chồng chéo khi đang chạy và nhả khóa an toàn nếu gặp lỗi DB", async () => {
    let resolvePending;
    const pendingPromise = new Promise((resolve) => {
      resolvePending = resolve;
    });

    const firstRun = dashboardRollupJob.tick({
      advanceRollupCutoff: () => pendingPromise,
    });
    const overlappingRun = await dashboardRollupJob.tick({
      advanceRollupCutoff: async () => ({ rolledUpRows: 99 }),
    });
    assert.equal(overlappingRun.skipped, true);

    resolvePending({ rolledUpRows: 5 });
    const firstResult = await firstRun;
    assert.equal(firstResult.skipped, false);
    assert.equal(firstResult.rolledUpRows, 5);

    // Lần gọi gặp lỗi -> không crash và cho phép lần gọi tiếp theo chạy bình thường
    const originalError = console.error;
    console.error = () => {};
    try {
      const errorRun = await dashboardRollupJob.tick({
        advanceRollupCutoff: async () => {
          throw new Error("Simulated transient DB failure");
        },
      });
      assert.equal(errorRun.skipped, false);
      assert.match(errorRun.error.message, /Simulated transient DB failure/);
    } finally {
      console.error = originalError;
    }

    const recoveryRun = await dashboardRollupJob.tick({
      advanceRollupCutoff: async () => ({ rolledUpRows: 3 }),
    });
    assert.equal(recoveryRun.skipped, false);
    assert.equal(recoveryRun.rolledUpRows, 3);
  });

  it("advanceRollupCutoff rollback giao dịch an toàn khi INSERT lỗi giữa chừng", async () => {
    const statements = [];
    let released = false;
    const fakeClient = {
      async query(sql) {
        statements.push(sql.trim());
        if (sql.includes("FROM public.dashboard_rollup_state") && sql.includes("target_cutoff")) {
          return {
            rows: [
              {
                rollup_until: new Date("2026-11-12T17:00:00.000Z"),
                is_finite: true,
                target_cutoff: new Date("2026-11-13T17:00:00.000Z"),
                next_cutoff: new Date("2026-11-13T17:00:00.000Z"),
              },
            ],
          };
        }
        if (sql.includes("FROM public.dashboard_rollup_state")) {
          return {
            rows: [{ rollup_until: new Date("2026-11-12T17:00:00.000Z"), is_finite: true }],
          };
        }
        if (sql.includes("DELETE FROM public.dashboard_dirty_hours") && sql.includes("ARRAY_AGG")) {
          return { rows: [{ hours: null }] };
        }
        if (sql.includes("INSERT INTO public.dashboard_tx_hourly")) {
          throw new Error("Simulated insert timeout");
        }
        return { rows: [], rowCount: 0 };
      },
      release() {
        released = true;
      },
    };

    await assert.rejects(
      () => dashboardRollup.advanceRollupCutoff({ async connect() { return fakeClient; } }),
      /Simulated insert timeout/
    );
    assert.equal(released, true);
    assert.ok(statements.includes("ROLLBACK"));
  });

  it("tick() chạy cả advanceReportRollupCutoff song song chu kỳ nền", async () => {
    let dashCalled = 0;
    let reportCalled = 0;
    const res = await dashboardRollupJob.tick({
      db: {},
      advanceRollupCutoff: async () => {
        dashCalled += 1;
        return { rolledUpRows: 4 };
      },
      advanceReportRollupCutoff: async () => {
        reportCalled += 1;
        return { rolledUpRows: 9 };
      },
    });
    assert.equal(dashCalled, 1);
    assert.equal(reportCalled, 1);
    assert.equal(res.rolledUpRows, 4);
    assert.deepEqual(res.reportRollup, { rolledUpRows: 9 });
  });
});
