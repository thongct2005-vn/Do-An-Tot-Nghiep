const mongoose = require("mongoose");
const { warnMongoAudit } = require("../../utils/db/audit");

const adminActionLogSchema = new mongoose.Schema(
  {
    admin_id: { type: String, default: null, index: true },
    email_hash: { type: String, default: null },
    method: { type: String, required: true },
    route: { type: String, required: true },
    target_id: { type: String, default: null },
    status_code: { type: Number, required: true },
    outcome: { type: String, enum: ["SUCCESS", "FAILED", "ABORTED"], required: true },
    ip: { type: String, default: null, index: true },
    user_agent: { type: String, default: null },
    occurred_at: { type: Date, required: true, index: true },
    duration_ms: { type: Number, required: true },
    environment: { type: String, required: true },
  },
  { collection: "admin_action_logs", versionKey: false, bufferCommands: false },
);
adminActionLogSchema.index({ admin_id: 1, occurred_at: -1 });
adminActionLogSchema.index({ environment: 1, occurred_at: -1 });
adminActionLogSchema.index({ environment: 1, admin_id: 1, occurred_at: -1 });
adminActionLogSchema.index({ environment: 1, outcome: 1, occurred_at: -1 });
adminActionLogSchema.index({ environment: 1, ip: 1, occurred_at: -1 });
adminActionLogSchema.index({ environment: 1, target_id: 1, occurred_at: -1 });

const AdminActionLog = mongoose.models.AdminActionLog ||
  mongoose.model("AdminActionLog", adminActionLogSchema);

async function recordAdminAction(event) {
  if (mongoose.connection.readyState !== 1) {
    warnMongoAudit("admin action skipped while disconnected");
    return null;
  }
  try {
    return await AdminActionLog.create(event);
  } catch (_) {
    warnMongoAudit("admin action write failed");
    return null;
  }
}

module.exports = { AdminActionLog, recordAdminAction };
