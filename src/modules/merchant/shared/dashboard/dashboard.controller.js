// dashboard.controller.js: Factory controller xử lý HTTP lấy thông tin, đổi callback và cấp/làm mới khóa Merchant.
const { successResponse } = require("../../../../utils/common/http");

function createDashboardController(dashboardService) {
  return {
    async getMerchantInfoById(req, res, next) {
      try {
        res.set('Cache-Control', 'no-store');
        const { user_id: userId } = req.user;
        const result = await dashboardService.getMerchantInfoById(userId);
        return successResponse(
          res,
          200,
          "Lấy thông tin cửa hàng thành công",
          result,
        );
      } catch (e) {
        next(e);
      }
    },
    async updateCallBackUrl(req, res, next){
      try {
          const { user_id:userId} =req.user;
          const { call_back_url:callbackUrl} = req.body;
          await dashboardService.updateCallBackUrl({userId, callbackUrl});
          return successResponse(res, 200, "Cập nhật callback thành công");
      } catch (e) {
          next(e);
      }
    },
    async resetApiKey(req, res, next){
      try {
         res.set('Cache-Control', 'no-store');
         const { user_id: userId } = req.user;
         const result = await dashboardService.resetApiKey(userId);
         return successResponse(res, 200, "Làm mới api key thành công", result);
      } catch (e) {
        next(e);
      }
    },
    async issueCredentials(req, res, next) {
      try {
        res.set("Cache-Control", "no-store");
        const { user_id: userId } = req.user;
        const result = await dashboardService.issueCredentials(userId);
        return successResponse(res, 200, "Tạo bộ khóa tích hợp thành công", result);
      } catch (e) {
        next(e);
      }
    },
     async resetSecretKey(req, res, next){
      try {
         const { user_id: userId } = req.user;
         const result = await dashboardService.resetSecretKey(userId);
         return successResponse(res, 200, "Làm mới secret key thành công", result);
      } catch (e) {
        next(e);
      }
    }
  };
}

module.exports = createDashboardController;