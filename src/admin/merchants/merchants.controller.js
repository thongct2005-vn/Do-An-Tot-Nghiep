const { successResponse } = require("../../utils/apiResponse");
const adminMerchantsService = require("./merchants.service");
const adminMerchantFeeService = require("./merchantFee.service");

const adminMerchantsController = {
  async updateMerchantStatus(req, res, next) {
    try {
      const result = await adminMerchantsService.updateMerchantStatus({
        adminId: req.user.user_id,
        merchantId: req.params.id,
        body: Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body,
      });
      return successResponse(res, 200, "Cập nhật trạng thái merchant thành công", result);
    } catch (error) {
      next(error);
    }
  },

  async updateMerchantProfile(req, res, next) {
    try {
      const result = await adminMerchantsService.updateMerchantProfile({
        adminId: req.user.user_id,
        merchantId: req.params.id,
        // Global sanitization can strip invalid phone/email characters. Validate
        // its original snapshot so malformed input cannot become a valid update.
        body: Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body,
      });
      return successResponse(res, 200, "Cập nhật hồ sơ merchant thành công", result);
    } catch (error) {
      next(error);
    }
  },

  async getMerchants(req, res, next) {
    try {
      const {
        page,
        limit,
        search,
        tab,
        approval_status,
        status,
        api_status,
        period,
        start_date,
        end_date,
      } = req.query;

      const result = await adminMerchantsService.getMerchants({
        page,
        limit,
        search,
        tab,
        approval_status,
        status,
        api_status,
        period,
        start_date,
        end_date,
      });

      return successResponse(
        res,
        200,
        "Lấy danh sách đối tác merchant thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getMerchantDetail(req, res, next) {
    try {
      const { id } = req.params;
      const result = await adminMerchantsService.getMerchantDetail(id);
      return successResponse(
        res,
        200,
        "Lấy thông tin chi tiết đối tác merchant thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getDefaultFeeConfig(req, res, next) {
    try {
      const result = await adminMerchantFeeService.getDefaultFeeConfig({
        role: req.query?.role || "MERCHANT",
      });
      return successResponse(
        res,
        200,
        "Lấy cấu hình biểu phí mặc định thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async previewDefaultFeeConfig(req, res, next) {
    try {
      const body = req.body || {};
      const config =
        body.config && typeof body.config === "object" ? body.config : body;
      const result = await adminMerchantFeeService.previewDefaultFeeConfigUpdate({
        role: req.query?.role || body.role || "MERCHANT",
        config,
        sampleAmounts: body.sample_amounts,
      });
      return successResponse(
        res,
        200,
        "Mô phỏng thay đổi biểu phí mặc định thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async updateDefaultFeeConfig(req, res, next) {
    try {
      const body = req.body || {};
      const config =
        body.config && typeof body.config === "object" ? body.config : body;
      const dryRun =
        Boolean(body.dry_run) ||
        String(req.query?.dry_run || "").toLowerCase() === "true";
      const result = await adminMerchantFeeService.updateDefaultFeeConfig({
        role: req.query?.role || body.role || "MERCHANT",
        config,
        reason: body.reason,
        adminId: req.user.user_id,
        dryRun,
        sampleAmounts: body.sample_amounts,
      });
      return successResponse(
        res,
        200,
        dryRun
          ? "Chạy thử (dry-run) cập nhật biểu phí mặc định thành công"
          : "Cập nhật biểu phí mặc định hệ thống thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getMerchantFeeConfig(req, res, next) {
    try {
      const result = await adminMerchantFeeService.getMerchantFeeConfig(
        req.params.id
      );
      return successResponse(
        res,
        200,
        "Lấy cấu hình biểu phí merchant thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async previewMerchantFeeConfig(req, res, next) {
    try {
      const body = req.body || {};
      const schedule =
        body.schedule && typeof body.schedule === "object"
          ? body.schedule
          : body;
      const result = await adminMerchantFeeService.previewMerchantFeeConfigUpdate({
        merchantId: req.params.id,
        schedule,
        sampleAmounts: body.sample_amounts,
      });
      return successResponse(
        res,
        200,
        "Mô phỏng biểu phí merchant thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async updateMerchantFeeConfig(req, res, next) {
    try {
      const body = req.body || {};
      const schedule =
        body.schedule && typeof body.schedule === "object"
          ? body.schedule
          : body;
      const dryRun =
        Boolean(body.dry_run) ||
        String(req.query?.dry_run || "").toLowerCase() === "true";
      const result = await adminMerchantFeeService.updateMerchantFeeConfig({
        merchantId: req.params.id,
        schedule,
        reason: body.reason,
        adminId: req.user.user_id,
        dryRun,
        sampleAmounts: body.sample_amounts,
      });
      return successResponse(
        res,
        200,
        dryRun
          ? "Chạy thử (dry-run) biểu phí merchant thành công"
          : "Cập nhật cấu hình biểu phí merchant thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getFeeConfigHistory(req, res, next) {
    try {
      const result = await adminMerchantFeeService.getFeeConfigHistory({
        merchantId: req.query?.merchant_id || null,
        action: req.query?.action || null,
        limit: req.query?.limit,
        offset: req.query?.offset,
      });
      return successResponse(
        res,
        200,
        "Lấy lịch sử thay đổi biểu phí thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminMerchantsController;

