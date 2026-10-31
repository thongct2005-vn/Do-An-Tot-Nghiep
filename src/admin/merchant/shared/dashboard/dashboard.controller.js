const { successResponse } = require("../../../../utils/apiResponse");

function createDashboardController(dashboardService) {
  return {
    async getMerchantInfoById(req, res, next) {
      try {
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
         const { user_id: userId } = req.user;
         const result = await dashboardService.resetApiKey(userId);
         return successResponse(res, 200, "Làm mới api key thành công", result);
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