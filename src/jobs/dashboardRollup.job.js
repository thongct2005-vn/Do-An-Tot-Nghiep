const pool = require("../config/database");
const dashboardRollup = require("../admin/dashboard/dashboardRollup");

const INTERVAL_MS = Number(process.env.DASHBOARD_ROLLUP_POLL_MS) || 60000;

let timer = null;
let running = false;

/**
 * Thực thi 1 chu kỳ đối soát dirty hours và cuộn mốc rollup_until về 00:00 hôm nay (Asia/Ho_Chi_Minh).
 */
async function tick(deps = {}) {
  if (running) {
    return { skipped: true };
  }
  running = true;
  try {
    const db = deps.db || pool;
    const advanceFn =
      deps.advanceRollupCutoff || dashboardRollup.advanceRollupCutoff;
    const result = await advanceFn(db);
    return { skipped: false, ...result };
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
