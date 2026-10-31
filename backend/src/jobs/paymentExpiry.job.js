const pool = require("../config/database");
const webhookRepository = require("../modules/webhook/webhook.repository");

const INTERVAL_MS = Number(process.env.PAYMENT_EXPIRY_POLL_MS) || 30000;

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const n = await webhookRepository.expireDuePayments(pool);
    if (n > 0) console.log(`[expiry] đã chuyển ${n} đơn hết hạn sang FAILED`);
  } catch (e) {
    console.error("[expiry] lỗi:", e.message);
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