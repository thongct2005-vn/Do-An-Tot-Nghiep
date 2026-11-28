// auditLogs.controller.js: Controller chỉ đọc cho phân hệ Nhật ký quản trị Admin (MongoDB + PostgreSQL).
const { successResponse } = require("../../utils/common/http");
const adminAuditLogsService = require("./auditLogs.service");

const adminAuditLogsController = {
  async listActors(req, res, next) {
    try {
      const data = await adminAuditLogsService.listActors();
      return successResponse(
        res,
        200,
        "Lấy danh sách quản trị viên thành công",
        data,
      );
    } catch (err) {
      return next(err);
    }
  },

  async getActionsSummary(req, res, next) {
    try {
      const data = await adminAuditLogsService.getActionsSummary(req.query);
      return successResponse(
        res,
        200,
        "Lấy thống kê nhật ký truy vấn thành công",
        data,
      );
    } catch (err) {
      return next(err);
    }
  },

  async listActions(req, res, next) {
    try {
      const data = await adminAuditLogsService.listActions(req.query);
      return successResponse(
        res,
        200,
        "Lấy danh sách nhật ký truy vấn thành công",
        data,
      );
    } catch (err) {
      return next(err);
    }
  },

  async getActionDetail(req, res, next) {
    try {
      const data = await adminAuditLogsService.getActionDetail(req.params.id);
      return successResponse(
        res,
        200,
        "Lấy chi tiết bản ghi nhật ký thành công",
        data,
      );
    } catch (err) {
      return next(err);
    }
  },

  async listChanges(req, res, next) {
    try {
      const data = await adminAuditLogsService.listChanges(req.query);
      return successResponse(
        res,
        200,
        "Lấy lịch sử thay đổi dữ liệu quản trị thành công",
        data,
      );
    } catch (err) {
      return next(err);
    }
  },
};

module.exports = adminAuditLogsController;
