const { successResponse } = require("../../utils/apiResponse");
const adminTransactionService = require("./transaction.service");

const adminTransactionController = {
  async getTransactions(req, res, next) {
    try {
      const {
        page,
        limit,
        type,
        status,
        initiated_by,
        keyword,
        period,
        start_date,
        end_date,
      } = req.query;

      const result = await adminTransactionService.getTransactions({
        page,
        limit,
        type,
        status,
        initiated_by,
        keyword,
        period,
        start_date,
        end_date,
      });

      return successResponse(
        res,
        200,
        "Lấy danh sách giao dịch thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getTransactionDetail(req, res, next) {
    try {
      const { id } = req.params;
      const result = await adminTransactionService.getTransactionDetail(id);

      return successResponse(
        res,
        200,
        "Lấy chi tiết giao dịch thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminTransactionController;

