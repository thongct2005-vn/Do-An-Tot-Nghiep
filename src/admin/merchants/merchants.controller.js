const { successResponse } = require("../../utils/apiResponse");
const adminMerchantsService = require("./merchants.service");
const adminUserService = require("../user/user.service");

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

  async updateMerchantStatus(req, res, next) {
    try {
      const adminId = req.user?.user_id;
      const { id: userId } = req.params;
      const { status, reason } = req.body;
      const result = await adminUserService.updateUserStatus({
        adminId,
        userId,
        status,
        reason,
      });
      return successResponse(
        res,
        200,
        status === "BLOCKED"
          ? "Đã khóa tài khoản đối tác merchant"
          : "Đã mở khóa tài khoản đối tác merchant",
        result
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminMerchantsController;

