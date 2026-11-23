// product.helpers.js: Mã hóa con trỏ, chuẩn hóa tham số lọc và map dòng thống kê sản phẩm bán chạy của Merchant.
const { resolveOneYearRange } = require("../../../../utils/common/dateRange");

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

function normalizeProductStatsFilters({
  startDate,
  endDate,
  sortBy,
  sortDir,
  sortByQuantity,
  keyword,
}) {
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

  return { startDay, endDay, normalizedSortBy, safeSort, safeKeyword };
}

function mapProductStatRow(row) {
  return {
    product_id: row.product_id,
    product_name: row.product_name,
    total_quantity_sold: Number(row.total_quantity_sold),
    gross_revenue: Number(row.gross_revenue ?? row.total_revenue ?? 0),
    total_merchant_fee: Number(row.total_merchant_fee ?? 0),
    total_revenue: Number(row.total_revenue),
  };
}

module.exports = {
  encodeCursor,
  decodeCursor,
  normalizeProductStatsFilters,
  mapProductStatRow,
};

