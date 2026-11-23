const pool = require("../config/database");
const postpaidRepository = require("../modules/postpaid/postpaid.repository");

const INTERVAL_MS = Number(process.env.POSTPAID_REMINDER_POLL_MS) || 15 * 60 * 1000;
const STARTUP_DELAY_MS = 5000;
const DEFAULT_BATCH_SIZE = 500;
const PUSH_CONCURRENCY = 15;

let startupTimer = null;
let timer = null;
let running = false;
let warnedMissingColumn = false;

async function defaultSendPushNotification(userId, payload, row) {
  if (!row?.fcm_token) {
    return { sent: false, reason: "NO_FCM_TOKEN" };
  }
  const { sendPushNotification } = require("../utils/notifications/firebaseNotification");
  await sendPushNotification(userId, payload);
  return { sent: true };
}

async function sendBatchNotifications(
  rows,
  { cycleMonth, templates, sendPushNotification, buildNotification },
) {
  let pushedCount = 0;
  let skippedNoTokenCount = 0;
  let failedCount = 0;

  for (let i = 0; i < rows.length; i += PUSH_CONCURRENCY) {
    const slice = rows.slice(i, i + PUSH_CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map(async (row) => {
        const payload = buildNotification(row, { cycleMonth, templates });
        return sendPushNotification(row.user_id, payload, row);
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        failedCount += 1;
        console.error(
          "[postpaid-reminder] Lỗi gửi thông báo:",
          outcome.reason?.message || outcome.reason,
        );
      } else if (outcome.value?.sent === false) {
        skippedNoTokenCount += 1;
      } else {
        pushedCount += 1;
      }
    }
  }

  return { pushedCount, skippedNoTokenCount, failedCount };
}

/**
 * Job gửi thông báo nhắc nợ Ví trả sau định kỳ hàng tháng (giờ Việt Nam UTC+7).
 * Lịch gửi (enabled, reminder_day, reminder_hour) và mẫu nội dung (templates) được đọc
 * trực tiếp từ `system_configs["POSTPAID_REMINDER_CONFIG"]`.
 */
async function tick(deps = {}) {
  if (running) {
    return { skipped: true, reason: "ALREADY_RUNNING" };
  }
  running = true;

  try {
    const db = deps.db || pool;
    const nowMs = deps.nowMs ?? Date.now();
    const batchSize = Math.min(Math.max(1, Number(deps.batchSize) || DEFAULT_BATCH_SIZE), 1000);
    const requireFcmToken = deps.requireFcmToken ?? true;

    const getReminderConfig =
      deps.getReminderConfig || (() => postpaidRepository.getReminderConfig(db));
    const reminderConfig = await getReminderConfig();

    if (!reminderConfig.enabled) {
      return { skipped: true, reason: "REMINDER_DISABLED" };
    }

    const reminderDay = deps.reminderDay ?? reminderConfig.reminder_day;
    const minHour = deps.minHour ?? reminderConfig.reminder_hour;

    const getDateMeta = deps.getVnDateMeta || postpaidRepository.getVnDateMeta;
    const vnMeta = getDateMeta(nowMs);

    if (vnMeta.day !== reminderDay) {
      return {
        skipped: true,
        reason: "NOT_REMINDER_DAY",
        cycleMonth: vnMeta.cycleMonth,
        day: vnMeta.day,
      };
    }

    if (vnMeta.hour < minHour) {
      return {
        skipped: true,
        reason: "BEFORE_REMINDER_HOUR",
        cycleMonth: vnMeta.cycleMonth,
        hour: vnMeta.hour,
      };
    }

    const claimBatch =
      deps.claimBatch ||
      ((params) => postpaidRepository.claimMonthlyDebtReminderBatch(params, db));
    const sendPush = deps.sendPushNotification || defaultSendPushNotification;
    const buildNotification =
      deps.buildNotification || postpaidRepository.buildMonthlyDebtReminderNotification;

    let claimedCount = 0;
    let pushedCount = 0;
    let skippedNoTokenCount = 0;
    let failedCount = 0;

    while (true) {
      const claimRes = await claimBatch({
        reminderMonth: vnMeta.cycleMonth,
        batchSize,
        requireFcmToken,
      });

      if (claimRes?.skipped && claimedCount === 0) {
        return {
          skipped: true,
          reason: claimRes.reason || "SKIPPED",
          cycleMonth: vnMeta.cycleMonth,
        };
      }

      const rows = Array.isArray(claimRes?.rows) ? claimRes.rows : [];
      if (rows.length === 0) break;

      claimedCount += rows.length;

      const effectiveTemplates =
        claimRes?.reminderConfig?.templates || reminderConfig.templates;

      const batchStats = await sendBatchNotifications(rows, {
        cycleMonth: vnMeta.cycleMonth,
        templates: effectiveTemplates,
        sendPushNotification: sendPush,
        buildNotification,
      });
      pushedCount += batchStats.pushedCount;
      skippedNoTokenCount += batchStats.skippedNoTokenCount;
      failedCount += batchStats.failedCount;

      if (rows.length < batchSize) break;
    }

    if (claimedCount > 0) {
      console.log(
        `[postpaid-reminder] Kỳ ${vnMeta.cycleMonth}: đã gửi nhắc nợ ${pushedCount}/${claimedCount} user` +
          (skippedNoTokenCount > 0 ? ` (bỏ qua ${skippedNoTokenCount} thiếu FCM token)` : "") +
          (failedCount > 0 ? ` (lỗi ${failedCount})` : ""),
      );
    }

    return {
      skipped: false,
      cycleMonth: vnMeta.cycleMonth,
      claimedCount,
      pushedCount,
      skippedNoTokenCount,
      failedCount,
    };
  } catch (e) {
    if (e?.code === "42703") {
      if (!warnedMissingColumn) {
        warnedMissingColumn = true;
        console.warn(
          "[postpaid-reminder] Thiếu cột last_reminder_month trên postpaid_wallets",
        );
      }
      return { skipped: true, reason: "MISSING_COLUMN", error: e };
    }
    if (e?.code === "42P01") {
      return { skipped: true, reason: "MISSING_TABLE", error: e };
    }
    console.error("[postpaid-reminder] Lỗi job nhắc nợ hàng tháng:", e.message);
    return { skipped: false, error: e };
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  // Quét 1 nhịp sớm ngay sau khi server khởi động để không phải đợi đủ 15 phút đầu tiên
  startupTimer = setTimeout(() => {
    startupTimer = null;
    tick();
  }, STARTUP_DELAY_MS);
  startupTimer.unref();

  timer = setInterval(() => {
    tick();
  }, INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, sendBatchNotifications };
