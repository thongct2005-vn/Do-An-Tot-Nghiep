const { successResponse } = require("../../utils/apiResponse");
const adminDashboardService = require("./dashboard.service");

const adminDashboardController = {
  async getOverview(req, res, next) {
    try {
      const { start_date, end_date } = req.query;
      const result = await adminDashboardService.getOverview({
        start_date,
        end_date,
      });
      return successResponse(
        res,
        200,
        "Lấy dữ liệu tổng quan Dashboard thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async getCashflow(req, res, next) {
    try {
      const { start_date, end_date } = req.query;
      const result = await adminDashboardService.getCashflow({
        start_date,
        end_date,
      });
      return successResponse(
        res,
        200,
        "Lấy thống kê dòng tiền Dashboard thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async getTransactionVolume(req, res, next) {
    try {
      const { start_date, end_date } = req.query;
      const result = await adminDashboardService.getTransactionVolume({
        start_date,
        end_date,
      });
      return successResponse(
        res,
        200,
        "Lấy thống kê số lượng giao dịch Dashboard thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminDashboardController;
