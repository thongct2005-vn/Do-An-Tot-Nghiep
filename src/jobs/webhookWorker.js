const webhookRepository = require("../modules/webhook/webhook.repository");
const { postCallBack } = require("../utils/axios");
const { decryptSecretKey } = require("../utils/hashSecretKey");

const POLL_INTERVAL_MS = Number(process.env.WEBHOOK_POLL_MS) || 5000;
const BATCH_SIZE = 10;

async function deliverOne(row) {
  try {
    if (!row.callback_url) throw new Error("Merchant chưa cấu hình callback URL");
    const secretKey = decryptSecretKey(row.secret_key);
    const { status } = await postCallBack({
      callbackUrl: row.callback_url,
      secretKey,
      payload: row.payload,
      deliveryId: row.id,
      attempt: row.attempt_count + 1,
    });
    await webhookRepository.markDelivered(row.id, status);
  } catch (e) {
    const httpStatus = e.response?.status ?? null;
    const reason = httpStatus ? `HTTP ${httpStatus}` : e.code || e.message;
    const { exhausted, delay } = await webhookRepository.markAttemptFailed(row.id, {
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      httpStatus,
      error: reason,
    });
    console.error(
      `[webhook] ${row.event_type} order=${row.payload?.order_id} lần ${row.attempt_count + 1}/${row.max_attempts} lỗi: ${reason}` +
        (exhausted ? " (bỏ cuộc)" : ` (thử lại sau ${delay}s)`),
    );
  }
}

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const rows = await webhookRepository.claimDue(BATCH_SIZE);
    await Promise.all(rows.map(deliverOne));
  } catch (e) {
    console.error("[webhook] lỗi vòng xử lý:", e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, POLL_INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };