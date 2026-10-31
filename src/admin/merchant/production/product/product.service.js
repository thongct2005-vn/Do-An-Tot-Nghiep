const productRepository = require("./product.repository");
const { httpError } = require("../../../../utils/httpError");

function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Lấy chuỗi ngày YYYY-MM-DD đầu tháng và cuối tháng hiện tại theo giờ Việt Nam
function getCurrentMonthDefaultDates() {
  const now = new Date();
  // Chuyển sang mốc giờ VN (UTC+7)
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const year = vnTime.getUTCFullYear();
  const month = vnTime.getUTCMonth() + 1;

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;

  // Ngày cuối tháng
  const lastDayObj = new Date(Date.UTC(year, month, 0));
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDayObj.getUTCDate()).padStart(2, "0")}`;

  return { startDate, endDate };
}

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
    { startDate, endDate, sortByQuantity, keyword, cursor, limit },
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    const defaultDates = getCurrentMonthDefaultDates();
    let startDay = defaultDates.startDate;
    let endDay = defaultDates.endDate;

    if (startDate) {
      if (!isValidDateOnly(startDate)) {
        throw httpError(400, "Ngày bắt đầu không hợp lệ");
      }
      startDay = startDate;
    }

    if (endDate) {
      if (!isValidDateOnly(endDate)) {
        throw httpError(400, "Ngày kết thúc không hợp lệ");
      }
      endDay = endDate;
    }

    if (startDay && endDay && startDay > endDay) {
      throw httpError(400, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
    }

    const safeSort =
      sortByQuantity && String(sortByQuantity).trim().toUpperCase() === "ASC"
        ? "ASC"
        : "DESC";
    const safeKeyword = keyword && keyword.trim() ? keyword.trim() : null;

    const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 50);

    let cursorQuantity = null;
    let cursorProductId = null;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        throw httpError(400, "Cursor không hợp lệ");
      }
      cursorQuantity = decoded.quantity;
      cursorProductId = decoded.productId;
    }

    const data = await productRepository.getTopSellingProducts(userId, {
      startDate: startDay,
      endDate: endDay,
      sortByQuantity: safeSort,
      keyword: safeKeyword,
      limit: limitNum,
      cursorQuantity,
      cursorProductId,
    });

    const rows = data.items || [];
    const hasMore = rows.length > limitNum;
    const pageRows = hasMore ? rows.slice(0, limitNum) : rows;

    let nextCursor = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = encodeCursor(last.total_quantity_sold, last.product_id);
    }

    return {
      products: pageRows.map((row) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        total_quantity_sold: Number(row.total_quantity_sold),
        total_revenue: Number(row.total_revenue),
      })),
      next_cursor: nextCursor,
      limit: limitNum,
    };
  },
};

module.exports = productService;