const merchantFeeService = require("../admin/merchant/production/fee/fee.service");

const INTERVAL_MS = Number(process.env.MERCHANT_FEE_POLL_MS) || 60_000;

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const count = await merchantFeeService.processDueRollovers();
    if (count > 0) {
      console.log(`[merchantFeeRollover] Đã xử lý chuyển kỳ thu phí cho ${count} merchant`);
    }
  } catch (e) {
    console.error("[merchantFeeRollover] Lỗi:", e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };

