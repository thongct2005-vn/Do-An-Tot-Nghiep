const { successResponse } = require("../../utils/apiResponse");
const adminSystemConfigService = require("./systemConfig.service");

function extractConfigPayload(rawBody) {
  const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody : {};
  if (Object.prototype.hasOwnProperty.call(body, "config")) {
    return body.config;
  }
  if (Object.prototype.hasOwnProperty.call(body, "proposed_config")) {
    return body.proposed_config;
  }
  const rest = { ...body };
  delete rest.reason;
  delete rest.dry_run;
  delete rest.key;
  return rest;
}

const adminSystemConfigController = {
  async listConfigs(req, res, next) {
    try {
      const result = await adminSystemConfigService.listConfigs();
      return successResponse(
        res,
        200,
        "Lấy danh sách cấu hình hệ thống thành công",
        result
      );
    } catch (error) {
      return next(error);
    }
  },

  async getConfig(req, res, next) {
    try {
      const result = await adminSystemConfigService.getConfig(req.params.key);
      return successResponse(
        res,
        200,
        "Lấy cấu hình hệ thống thành công",
        result
      );
    } catch (error) {
      return next(error);
    }
  },

  async previewConfigUpdate(req, res, next) {
    try {
      const body = Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body;
      const result = await adminSystemConfigService.previewConfigUpdate(
        req.params.key,
        extractConfigPayload(body)
      );
      return successResponse(
        res,
        200,
        "Xem trước thay đổi cấu hình hệ thống thành công",
        result
      );
    } catch (error) {
      return next(error);
    }
  },

  async updateConfig(req, res, next) {
    try {
      const body = Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body || {};
      const dryRun =
        Boolean(body?.dry_run) ||
        String(req.query?.dry_run || "").toLowerCase() === "true";

      const result = await adminSystemConfigService.updateConfig({
        key: req.params.key,
        config: extractConfigPayload(body),
        reason: body?.reason,
        adminId: req.user?.user_id,
        dryRun,
      });

      return successResponse(
        res,
        200,
        dryRun
          ? "Xem trước thay đổi cấu hình hệ thống thành công"
          : "Cập nhật cấu hình hệ thống thành công",
        result
      );
    } catch (error) {
      return next(error);
    }
  },

  async getConfigHistory(req, res, next) {
    try {
      const result = await adminSystemConfigService.getConfigHistory({
        key: req.query?.key || null,
        limit: req.query?.limit,
        offset: req.query?.offset,
      });
      return successResponse(
        res,
        200,
        "Lấy lịch sử thay đổi cấu hình hệ thống thành công",
        result
      );
    } catch (error) {
      return next(error);
    }
  },
};

module.exports = adminSystemConfigController;
