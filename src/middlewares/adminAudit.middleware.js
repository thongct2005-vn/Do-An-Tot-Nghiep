const { createHash } = require("node:crypto");
const { recordAdminAction } = require("../models/mongo/adminActionLog.model");
const { warnMongoAudit } = require("../utils/db/audit");

const MAX_IP_LENGTH = 64;
const MAX_UA_LENGTH = 120;
const MAX_TARGET_ID_LENGTH = 120;

function sanitizeControlChars(value) {
  return String(value)
    .replace(/[\r\n\u0000-\u001F\u007F]+/g, " ")
    .trim();
}

function normalizeAuditIp(req) {
  const raw = req?.ip || req?.socket?.remoteAddress || null;
  if (raw == null) return null;
  const cleaned = sanitizeControlChars(raw).replace(/^::ffff:/i, "");
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_IP_LENGTH);
}

function normalizeAuditUserAgent(req) {
  const raw =
    typeof req?.get === "function"
      ? req.get("user-agent")
      : req?.headers?.["user-agent"];
  if (raw == null) return null;
  const cleaned = sanitizeControlChars(raw);
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_UA_LENGTH);
}

function extractAuditTargetId(req) {
  const raw = req?.params?.id ?? req?.params?.userId ?? req?.params?.key ?? null;
  if (raw == null) return null;
  const cleaned = sanitizeControlChars(raw);
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_TARGET_ID_LENGTH);
}

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
      target_id: extractAuditTargetId(req),
      status_code: status,
      outcome: aborted ? "ABORTED" : status < 400 ? "SUCCESS" : "FAILED",
      ip: normalizeAuditIp(req),
      user_agent: normalizeAuditUserAgent(req),
      occurred_at: new Date(startedAt),
      duration_ms: Math.max(0, Date.now() - startedAt),
      environment: process.env.NODE_ENV || "unknown",
    }).catch(() => warnMongoAudit("admin action write failed"));
  }
  res.once("finish", () => record(false));
  res.once("close", () => record(true));
  next();
}

adminAudit.normalizeAuditIp = normalizeAuditIp;
adminAudit.normalizeAuditUserAgent = normalizeAuditUserAgent;
adminAudit.extractAuditTargetId = extractAuditTargetId;

module.exports = adminAudit;
