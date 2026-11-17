const pool = require("../config/database");
const transactionRepository = require("../modules/transaction/transaction.repository");

const INTERVAL_MS =
  Number(process.env.IDEMPOTENCY_CLEANUP_POLL_MS) || 60 * 60 * 1000;
const STARTUP_DELAY_MS = 10_000;
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_MAX_BATCHES = 10;

let startupTimer = null;
let timer = null;
let running = false;
let warnedMissingSchema = false;

/**
 * Job dọn định kỳ các khóa `idempotency_keys` đã quá hạn (`expires_at < NOW()`).
 */
async function tick(deps = {}) {
  if (running) {
    return { skipped: true, reason: "ALREADY_RUNNING" };
  }
  running = true;
  try {
    const db = deps.db || pool;
    const cleanup =
      deps.cleanupExpiredIdempotencyKeys ||
      ((targetDb, opts) =>
        transactionRepository.cleanupExpiredIdempotencyKeys(targetDb, opts));

    const { deletedCount } = await cleanup(db, {
      batchSize: deps.batchSize || DEFAULT_BATCH_SIZE,
      maxBatches: deps.maxBatches || DEFAULT_MAX_BATCHES,
    });

    if (deletedCount > 0) {
      console.log(`[idempotency] Đã dọn ${deletedCount} khóa idempotency quá hạn`);
    }

    return { skipped: false, deletedCount };
  } catch (e) {
    if (e?.code === "42P01" || e?.code === "42703") {
      if (!warnedMissingSchema) {
        warnedMissingSchema = true;
        console.warn(
          "[idempotency] Bỏ qua dọn idempotency_keys do thiếu bảng hoặc cột expires_at",
        );
      }
      return { skipped: true, reason: "MISSING_SCHEMA", error: e };
    }
    console.error("[idempotency] Lỗi job dọn idempotency_keys:", e.message);
    return { skipped: false, error: e };
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    tick();
  }, STARTUP_DELAY_MS);
  startupTimer.unref();

  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };

