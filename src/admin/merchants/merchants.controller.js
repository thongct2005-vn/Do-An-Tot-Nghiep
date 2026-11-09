const { successResponse } = require("../../utils/apiResponse");
const adminMerchantsService = require("./merchants.service");

const adminMerchantsController = {
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
};

module.exports = adminMerchantsController;

