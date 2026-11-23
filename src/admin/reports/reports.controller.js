// reports.controller.js: Controller xử lý các endpoint báo cáo phí Merchant, tăng trưởng, đăng nhập và xuất Excel tài chính.
const { successResponse } = require("../../utils/common/http");
const { sendXlsxResponse } = require("../../utils/files/exportExcel");
const adminReportsService = require("./reports.service");
const adminFinancialReportService = require("./financialReport.service");

const adminReportsController = {
  async getMerchantReport(req, res, next) {
    try {
      return successResponse(
        res,
        200,
        "Báo cáo phí Merchant",
        await adminReportsService.report(req.query),
      );
    } catch (e) {
      return next(e);
    }
  },

  async getGrowthReport(req, res, next) {
    try {
      return successResponse(
        res,
        200,
        "Tăng trưởng theo kỳ",
        await adminReportsService.growth(req.query),
      );
    } catch (e) {
      return next(e);
    }
  },

  async getLoginStats(req, res, next) {
    try {
      return successResponse(
        res,
        200,
        "Đăng nhập Mobile App",
        await adminReportsService.logins(req.query),
      );
    } catch (e) {
      return next(e);
    }
  },

  async exportFinancialReport(req, res, next) {
    try {
      const { buffer, fileName } =
        await adminFinancialReportService.exportFinancialReport(
          req.query,
          req.user.user_id,
        );
      return sendXlsxResponse(res, { buffer: Buffer.from(buffer), fileName });
    } catch (e) {
      return next(e);
    }
  },
};

module.exports = adminReportsController;
