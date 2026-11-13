const { successResponse } = require("../../../../utils/apiResponse");
const { sendXlsx } = require("../../../../utils/exportExcel");
const productService = require("./product.service");

const productController = {
  async getTopSellingProducts(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const {
        start_date: startDate,
        end_date: endDate,
        sort_by: sortBy,
        sort_dir: sortDir,
        sort_by_quantity: sortByQuantity,
        keyword,
        cursor,
        limit,
      } = req.query;

      const result = await productService.getTopSellingProducts(userId, {
        startDate,
        endDate,
        sortBy,
        sortDir,
        sortByQuantity,
        keyword,
        cursor,
        limit,
      });

      return successResponse(
        res,
        200,
        "Lấy thống kê sản phẩm bán chạy thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async exportTopSellingProducts(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const {
        start_date: startDate,
        end_date: endDate,
        sort_by: sortBy,
        sort_dir: sortDir,
        sort_by_quantity: sortByQuantity,
        keyword,
      } = req.query;

      const file = await productService.exportTopSellingProducts(userId, {
        startDate,
        endDate,
        sortBy,
        sortDir,
        sortByQuantity,
        keyword,
      });

      return sendXlsx(res, file);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = productController;