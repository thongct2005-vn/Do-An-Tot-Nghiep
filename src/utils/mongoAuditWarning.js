const lastWarningAt = new Map();
const WARNING_INTERVAL_MS = 60000;

function warnMongoAudit(kind) {
  const now = Date.now();
  if (now - (lastWarningAt.get(kind) || 0) < WARNING_INTERVAL_MS) return;
  lastWarningAt.set(kind, now);
  console.warn(`MongoDB audit event unavailable: ${kind}`);
}

module.exports = { warnMongoAudit };
