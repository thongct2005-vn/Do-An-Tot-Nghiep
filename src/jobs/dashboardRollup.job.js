const pool = require("../config/database");
const { getAnalyticsStorageMode } = require("../admin/analyticsStorage");
const dashboardRollup = require("../admin/dashboard/dashboardRollup");
const reportRollup = require("../admin/reports/reportRollup");
const { advanceLoginRollupCutoff } = require("../models/mongo/loginStatsDailyUser.model");

const INTERVAL_MS = Number(process.env.DASHBOARD_ROLLUP_POLL_MS) || 60000;

let timer = null;
let running = false;

/**
 * Thực thi 1 chu kỳ đối soát dirty buckets và cuộn mốc rollup_until cho Dashboard, Reports & Login stats
 * theo ANALYTICS_STORAGE_MODE ('v1' | 'v2' | 'raw').
 */
async function tick(deps = {}) {
  if (running) {
    return { skipped: true };
  }
  running = true;
  try {
    const db = deps.db || pool;
    const mode = deps.storageMode || getAnalyticsStorageMode();
    const advanceFn =
      deps.advanceRollupCutoff || dashboardRollup.advanceRollupCutoff;
    const result = await advanceFn(db, { storageMode: mode });
    let reportResult = null;
    if (deps.advanceReportRollupCutoff || !deps.advanceRollupCutoff) {
      const advanceReportFn =
        deps.advanceReportRollupCutoff || reportRollup.advanceReportRollupCutoff;
      reportResult = await advanceReportFn(db, { storageMode: mode });
    }
    let loginResult = null;
    if (deps.advanceLoginRollupCutoff || !deps.advanceRollupCutoff) {
      const advanceLoginFn =
        deps.advanceLoginRollupCutoff || advanceLoginRollupCutoff;
      loginResult = await advanceLoginFn();
    }
    return {
      skipped: false,
      mode,
      ...result,
      ...(reportResult ? { reportRollup: reportResult } : {}),
      ...(loginResult && !loginResult.skippedDisconnected
        ? { loginRollup: loginResult }
        : {}),
    };
  } catch (e) {
    console.error("Dashboard rollup job error:", e.message);
    return { skipped: false, error: e };
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    tick();
  }, INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
