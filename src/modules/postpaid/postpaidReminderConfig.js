const { httpError } = require("../../utils/httpError");

const REMINDER_TEMPLATE_KEYS = Object.freeze(["PAST_DUE", "BILLED", "UNBILLED"]);

function parseReminderInt(val, minVal, maxVal, invalidMessage) {
  if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
    throw httpError(500, "Hệ thống chưa thiết lập đầy đủ lịch gửi nhắc nợ Ví trả sau");
  }
  const n =
    typeof val === "number"
      ? val
      : typeof val === "string" && /^-?\d+$/.test(val.trim())
        ? Number(val.trim())
        : NaN;
  if (!Number.isSafeInteger(n) || n < minVal || n > maxVal) {
    throw httpError(500, invalidMessage);
  }
  return n;
}

/**
 * Chuẩn hóa & kiểm tra cấu hình nhắc nợ Ví trả sau đọc từ `system_configs["POSTPAID_REMINDER_CONFIG"]`.
 */
function normalizePostpaidReminderConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw httpError(500, "Cấu hình nhắc nợ Ví trả sau trong hệ thống không hợp lệ");
  }
  if (raw.enabled === undefined || raw.enabled === null) {
    throw httpError(500, "Hệ thống chưa thiết lập trạng thái bật hoặc tắt nhắc nợ Ví trả sau");
  }
  if (typeof raw.enabled !== "boolean") {
    throw httpError(500, "Cấu hình trạng thái bật hoặc tắt nhắc nợ Ví trả sau không hợp lệ");
  }

  const reminderDay = parseReminderInt(
    raw.reminder_day,
    1,
    28,
    "Cấu hình ngày gửi nhắc nợ Ví trả sau phải từ ngày 1 đến ngày 28",
  );
  const reminderHour = parseReminderInt(
    raw.reminder_hour,
    0,
    23,
    "Cấu hình giờ gửi nhắc nợ Ví trả sau phải từ 0 đến 23 giờ",
  );

  const rawTemplates = raw.templates;
  if (!rawTemplates || typeof rawTemplates !== "object" || Array.isArray(rawTemplates)) {
    throw httpError(500, "Hệ thống chưa thiết lập đầy đủ mẫu nội dung nhắc nợ Ví trả sau");
  }

  const templates = {};
  for (const key of REMINDER_TEMPLATE_KEYS) {
    const entry = rawTemplates[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw httpError(500, "Hệ thống chưa thiết lập đầy đủ mẫu nội dung nhắc nợ Ví trả sau");
    }
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const body = typeof entry.body === "string" ? entry.body.trim() : "";
    if (!title || !body) {
      throw httpError(500, "Mẫu nội dung nhắc nợ Ví trả sau trong hệ thống không hợp lệ");
    }
    templates[key] = Object.freeze({ title, body });
  }

  return {
    enabled: raw.enabled,
    reminder_day: reminderDay,
    reminder_hour: reminderHour,
    templates: Object.freeze(templates),
  };
}

module.exports = {
  REMINDER_TEMPLATE_KEYS,
  normalizePostpaidReminderConfig,
};

