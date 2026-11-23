const mongoose = require("mongoose");
const { maskPhone } = require("../../utils/common/text");
const { warnMongoAudit } = require("../../utils/db/audit");

const thresholdSchema = new mongoose.Schema(
  {
    challenge: { type: Number, required: true },
    block: { type: Number, required: true },
  },
  { _id: false },
);

const securityEventSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["CHALLENGE", "BLOCK", "DRY_RUN_WOULD_BLOCK"],
      required: true,
      index: true,
    },
    method: { type: String, required: true },
    path: { type: String, required: true },
    ip: { type: String, default: null, index: true },
    phone: { type: String, default: null },
    user_id: { type: String, default: null, index: true },
    score: { type: Number, required: true },
    threshold: { type: thresholdSchema, required: true },
    reasons: { type: [String], default: [] },
    occurred_at: { type: Date, default: Date.now, required: true, index: true },
  },
  {
    collection: "security_events",
    versionKey: false,
    bufferCommands: false,
  },
);

securityEventSchema.index({ action: 1, occurred_at: -1 });
securityEventSchema.index({ ip: 1, occurred_at: -1 });
securityEventSchema.index({ user_id: 1, occurred_at: -1 });

const SecurityEvent =
  mongoose.models.SecurityEvent ||
  mongoose.model("SecurityEvent", securityEventSchema);

function sanitizePath(rawPath) {
  if (rawPath === undefined || rawPath === null) return "";
  return String(rawPath).split("?", 1)[0];
}

function sanitizeMaskedPhone(rawPhone) {
  if (rawPhone === undefined || rawPhone === null) return null;
  const text = String(rawPhone).trim();
  if (!text) return null;
  return text.includes("*") ? text : maskPhone(text);
}

/**
 * Ghi nhận sự kiện cảnh báo bảo mật (CHALLENGE / BLOCK / DRY_RUN_WOULD_BLOCK)
 * vào MongoDB theo cơ chế fail-safe, không chặn luồng xử lý request chính.
 */
async function recordSecurityEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  if (mongoose.connection.readyState !== 1) {
    warnMongoAudit("security event skipped while disconnected");
    return null;
  }
  try {
    return await SecurityEvent.create({
      action: event.action,
      method: String(event.method || "").toUpperCase(),
      path: sanitizePath(event.path),
      ip: event.ip == null ? null : String(event.ip),
      phone: sanitizeMaskedPhone(event.phone),
      user_id: event.user_id == null ? null : String(event.user_id),
      score: Number(event.score),
      threshold: {
        challenge: Number(event.threshold?.challenge),
        block: Number(event.threshold?.block),
      },
      reasons: Array.isArray(event.reasons) ? event.reasons.map(String) : [],
      occurred_at:
        event.occurred_at instanceof Date ? event.occurred_at : new Date(),
    });
  } catch (_) {
    warnMongoAudit("security event write failed");
    return null;
  }
}

module.exports = { SecurityEvent, recordSecurityEvent };
