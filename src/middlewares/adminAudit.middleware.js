const { createHash } = require("node:crypto");
const { recordAdminAction } = require("../models/mongo/adminActionLog.model");
const { warnMongoAudit } = require("../utils/mongoAuditWarning");

function adminAudit(req, res, next) {
  const startedAt = Date.now();
  let recorded = false;
  function record(aborted) {
    if (recorded) return;
    recorded = true;
    const isLogin = req.method === "POST" &&
      req.originalUrl.split("?", 1)[0].endsWith("/admin/auth/login");
    const rawEmail = isLogin && typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase() : "";
    const emailHash = rawEmail && rawEmail.length <= 254
      ? createHash("sha256").update(rawEmail).digest("hex") : null;
    const template = req.route?.path;
    const route = template
      ? `${req.baseUrl}${Array.isArray(template) ? template[0] : template}`
      : "/admin/*";
    const adminId = res.locals.auditAdminId ||
      (req.user?.type === "ADMIN" ? req.user.user_id : null);
    const status = res.statusCode;
    void recordAdminAction({
      admin_id: adminId == null ? null : String(adminId),
      email_hash: isLogin ? emailHash : null,
      method: req.method,
      route,
      target_id: req.params?.id == null ? null : String(req.params.id),
      status_code: status,
      outcome: aborted ? "ABORTED" : status < 400 ? "SUCCESS" : "FAILED",
      occurred_at: new Date(startedAt),
      duration_ms: Math.max(0, Date.now() - startedAt),
      environment: process.env.NODE_ENV || "unknown",
    }).catch(() => warnMongoAudit("admin action write failed"));
  }
  res.once("finish", () => record(false));
  res.once("close", () => record(true));
  next();
}

module.exports = adminAudit;
