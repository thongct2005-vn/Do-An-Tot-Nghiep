const productRepository = require("./product.repository");
const { httpError } = require("../../../../utils/httpError");
const { getPositiveIntConfig } = require("../../../../utils/limitsDb");
const { resolveOneYearRange } = require("../../../../utils/exportRange");
const { buildProductStatsXlsx } = require("../../../../utils/exportExcel");

/**
 * Encode / decode cursor: "{total_quantity_sold}:{product_id}"
 * Ví dụ: "120:sku-abc-001"
 */
function encodeCursor(totalQuantitySold, productId) {
  return `${Number(totalQuantitySold)}:${String(productId)}`;
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== "string") return null;
  const trimmed = cursor.trim();
  if (!trimmed) return null;

  const sepIndex = trimmed.indexOf(":");
  if (sepIndex <= 0) return null;

  const qtyPart = trimmed.slice(0, sepIndex);
  const productId = trimmed.slice(sepIndex + 1);
  if (!productId) return null;

  const quantity = Number(qtyPart);
  if (!Number.isFinite(quantity) || quantity < 0) return null;

  return { quantity, productId };
}

const productService = {
  async getTopSellingProducts(
    userId,
    { startDate, endDate, sortBy, sortDir, sortByQuantity, keyword, cursor, limit },
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    const { startDate: startDay, endDate: endDay } = resolveOneYearRange(
      startDate,
      endDate,
      {
        defaultToOneYear: true,
        defaultEndToToday: true,
        tooOldMessage:
          "Chỉ có thể xem thống kê sản phẩm trong vòng 1 năm gần nhất",
      },
    );

    const normalizedSortBy =
      sortBy && String(sortBy).trim().toLowerCase() === "revenue"
        ? "revenue"
        : "quantity";
    const rawSortDir = sortDir ?? sortByQuantity;
    const safeSort =
      rawSortDir && String(rawSortDir).trim().toUpperCase() === "ASC"
        ? "ASC"
        : "DESC";
    const safeKeyword = keyword && keyword.trim() ? keyword.trim() : null;

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
      products: pageRows.map((row) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        total_quantity_sold: Number(row.total_quantity_sold),
        gross_revenue: Number(row.gross_revenue ?? row.total_revenue ?? 0),
        total_merchant_fee: Number(row.total_merchant_fee ?? 0),
        total_revenue: Number(row.total_revenue),
      })),
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

    const { startDate: startDay, endDate: endDay } = resolveOneYearRange(
      startDate,
      endDate,
      {
        defaultToOneYear: true,
        defaultEndToToday: true,
        tooOldMessage:
          "Chỉ có thể xem thống kê sản phẩm trong vòng 1 năm gần nhất",
      },
    );

    const normalizedSortBy =
      sortBy && String(sortBy).trim().toLowerCase() === "revenue"
        ? "revenue"
        : "quantity";
    const rawSortDir = sortDir ?? sortByQuantity;
    const safeSort =
      rawSortDir && String(rawSortDir).trim().toUpperCase() === "ASC"
        ? "ASC"
        : "DESC";
    const safeKeyword = keyword && keyword.trim() ? keyword.trim() : null;

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

    const products = (data.items || []).map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      total_quantity_sold: Number(row.total_quantity_sold),
      gross_revenue: Number(row.gross_revenue ?? row.total_revenue ?? 0),
      total_merchant_fee: Number(row.total_merchant_fee ?? 0),
      total_revenue: Number(row.total_revenue),
    }));

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