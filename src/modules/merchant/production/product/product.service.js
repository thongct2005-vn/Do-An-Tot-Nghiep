// product.service.js: Nghiệp vụ thống kê phân trang con trỏ và xuất Excel sản phẩm bán chạy cho Merchant.
const productRepository = require("./product.repository");
const { httpError } = require("../../../../utils/common/http");
const { getPositiveIntConfig } = require("../../../../utils/limits/limitsDb");
const { buildProductStatsXlsx } = require("../../../../utils/files/exportExcel");
const {
  encodeCursor,
  decodeCursor,
  normalizeProductStatsFilters,
  mapProductStatRow,
} = require("./product.helpers");

const productService = {
  async getTopSellingProducts(
    userId,
    { startDate, endDate, sortBy, sortDir, sortByQuantity, keyword, cursor, limit },
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    const { startDay, endDay, normalizedSortBy, safeSort, safeKeyword } =
      normalizeProductStatsFilters({
        startDate,
        endDate,
        sortBy,
        sortDir,
        sortByQuantity,
        keyword,
      });

    const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 50);

    let cursorValue = null;
    let cursorProductId = null;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        throw httpError(400, "Con trỏ phân trang không hợp lệ");
      }
      cursorValue = decoded.quantity;
      cursorProductId = decoded.productId;
    }

    const data = await productRepository.getTopSellingProducts(userId, {
      startDate: startDay,
      endDate: endDay,
      sortBy: normalizedSortBy,
      sortDir: safeSort,
      keyword: safeKeyword,
      limit: limitNum,
      cursorValue,
      cursorProductId,
    });

    const rows = data.items || [];
    const hasMore = rows.length > limitNum;
    const pageRows = hasMore ? rows.slice(0, limitNum) : rows;

    let nextCursor = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      const cursorMetric =
        normalizedSortBy === "revenue"
          ? last.total_revenue
          : last.total_quantity_sold;
      nextCursor = encodeCursor(cursorMetric, last.product_id);
    }

    return {
      products: pageRows.map(mapProductStatRow),
      next_cursor: nextCursor,
      limit: limitNum,
    };
  },

  async exportTopSellingProducts(
    userId,
    { startDate, endDate, sortBy, sortDir, sortByQuantity, keyword },
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    const { startDay, endDay, normalizedSortBy, safeSort, safeKeyword } =
      normalizeProductStatsFilters({
        startDate,
        endDate,
        sortBy,
        sortDir,
        sortByQuantity,
        keyword,
      });

    const exportMaxRows = await getPositiveIntConfig("EXPORT_MAX_ROWS");
    const data = await productRepository.getTopSellingProducts(userId, {
      startDate: startDay,
      endDate: endDay,
      sortBy: normalizedSortBy,
      sortDir: safeSort,
      keyword: safeKeyword,
      limit: exportMaxRows,
      cursorValue: null,
      cursorProductId: null,
    });
    if ((data.items || []).length > exportMaxRows) {
      throw httpError(
        400,
        `Có hơn ${exportMaxRows.toLocaleString("vi-VN")} sản phẩm trong khoảng thời gian này, vui lòng chọn khoảng ngắn hơn hoặc thêm từ khóa tìm kiếm`,
      );
    }

    const products = (data.items || []).map(mapProductStatRow);

    const buffer = await buildProductStatsXlsx({
      products,
      startDate: startDay,
      endDate: endDay,
      keyword: safeKeyword,
    });

    return {
      buffer,
      fileName: `thong-ke-san-pham_${startDay}_den_${endDay}.xlsx`,
    };
  },
};

module.exports = productService;
