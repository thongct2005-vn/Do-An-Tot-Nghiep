const { successResponse } = require("../../../../utils/apiResponse");
const productService = require("./product.service");

const productController = {
  async getTopSellingProducts(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const {
        start_date: startDate,
        end_date: endDate,
        sort_by_quantity: sortByQuantity,
        keyword,
        cursor,
        limit,
      } = req.query;

      const result = await productService.getTopSellingProducts(userId, {
        startDate,
        endDate,
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
};

module.exports = productController;