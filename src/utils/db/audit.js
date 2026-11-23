// audit.js: Tiện ích ghi sự kiện kiểm toán (audit_outbox) và cảnh báo log kiểm toán MongoDB.

const lastWarningAt = new Map();
const WARNING_INTERVAL_MS = 60000;

/**
 * Ghi bản ghi audit_outbox bằng db/client truyền vào (dùng bên trong transaction).
 */
async function recordAudit(db, { eventType, payload }) {
  await db.query(
    `INSERT INTO audit_outbox (event_type, payload) VALUES ($1, $2::jsonb)`,
    [eventType, JSON.stringify(payload)],
  );
}

/**
 * Ghi bản ghi audit_outbox độc lập trên pool, không làm sập luồng chính nếu gặp lỗi.
 */
async function recordAuditSafe({ eventType, payload }) {
  try {
    const pool = require("../../config/database");
    await recordAudit(pool, { eventType, payload });
  } catch (err) {
    console.error("Ghi audit_outbox thất bại:", err.message);
  }
}

function warnMongoAudit(kind) {
  const now = Date.now();
  if (now - (lastWarningAt.get(kind) || 0) < WARNING_INTERVAL_MS) return;
  lastWarningAt.set(kind, now);
  console.warn(`MongoDB audit event unavailable: ${kind}`);
}

module.exports = {
  recordAudit,
  recordAuditSafe,
  warnMongoAudit,
};

