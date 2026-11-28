// auditLogs.routes.js: Khai báo 5 tuyến GET chỉ đọc cho phân hệ Nhật ký quản trị (/admin/audit-logs).
const express = require("express");
const authMiddleware = require("../../middlewares/auth.middleware");
const requireCurrentAdminSession = require("../auth/adminSession.middleware");
const adminAuditLogsController = require("./auditLogs.controller");

const router = express.Router();

router.use(authMiddleware.verifyAccessToken);
router.use(authMiddleware.requireRole("ADMIN"));
router.use(requireCurrentAdminSession);

router.get("/actors", adminAuditLogsController.listActors);
router.get("/actions/summary", adminAuditLogsController.getActionsSummary);
router.get("/actions", adminAuditLogsController.listActions);
router.get("/actions/:id", adminAuditLogsController.getActionDetail);
router.get("/changes", adminAuditLogsController.listChanges);

module.exports = router;
