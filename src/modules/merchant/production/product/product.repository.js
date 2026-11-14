const pool = require("../../../../config/database");

const productRepository = {
  async getTopSellingProducts(
    userId,
    {
      startDate = null,
      endDate = null,
      sortBy = "quantity",
      sortDir = "DESC",
      sortByQuantity = null,
      keyword = null,
      limit = 20,
      cursorValue = null,
      cursorQuantity = null,
      cursorProductId = null,
    } = {},
  ) {
    const hasStartDate = Boolean(startDate);
    const hasEndDate = Boolean(endDate);
    const hasKeyword = Boolean(keyword && keyword.trim());
    const safeKeyword = hasKeyword
      ? keyword.trim().replace(/[\\%_]/g, "\\$&")
      : null;

    const isRevenueSort = String(sortBy).toLowerCase() === "revenue";
    const safeSort =
      String(sortDir || sortByQuantity || "DESC").toUpperCase() === "ASC"
        ? "ASC"
        : "DESC";
    const effectiveCursorValue = cursorValue ?? cursorQuantity;
    const hasCursor =
      effectiveCursorValue !== null &&
      effectiveCursorValue !== undefined &&
      Boolean(cursorProductId);

    const itemGrossExpr = "(pri.quantity * pri.unit_price)";
    const itemFeeExpr = `CASE
      WHEN COALESCE(pr.amount, 0) > 0 AND ${itemGrossExpr} <> pr.amount
        THEN ROUND(COALESCE(t.merchant_fee, 0)::numeric * ${itemGrossExpr}::numeric / pr.amount::numeric)::bigint
      ELSE COALESCE(t.merchant_fee, 0)::bigint
    END`;
    const itemNetExpr = `GREATEST(0, ${itemGrossExpr} - (${itemFeeExpr}))`;

    const sortExpr = isRevenueSort
      ? `SUM(${itemNetExpr})`
      : "SUM(pri.quantity)";
    const sortAlias = isRevenueSort ? "total_revenue" : "total_quantity_sold";

    const fetchLimit =
      limit === null || limit === undefined ? null : limit + 1;

    const result = await pool.query(
      `
      SELECT
        pri.product_id,
        MAX(pri.name) AS product_name,
        SUM(pri.quantity)::bigint AS total_quantity_sold,
        SUM(${itemGrossExpr})::bigint AS gross_revenue,
        SUM(${itemFeeExpr})::bigint AS total_merchant_fee,
        SUM(${itemNetExpr})::bigint AS total_revenue
      FROM payment_request_items pri
      JOIN payment_requests pr ON pri.payment_request_id = pr.id
      LEFT JOIN transactions t ON t.id = pr.transaction_id
      WHERE pr.destination_user_id = $1
        AND pr.status = 'SUCCESS'
        AND pr.paid_at IS NOT NULL
        AND (
          $2::boolean = false
          OR pr.paid_at >= (($3::text)::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
        )
        AND (
          $4::boolean = false
          OR pr.paid_at < ((($5::text)::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        )
        AND (
          $6::boolean = false
          OR pri.name ILIKE '%' || $7 || '%'
        )
      GROUP BY pri.product_id
      HAVING (
        $9::boolean = false
        OR (
          CASE
            WHEN $12::text = 'DESC' THEN
              (
                ${sortExpr} < $10::bigint
                OR (
                  ${sortExpr} = $10::bigint
                  AND pri.product_id > $11::text
                )
              )
            ELSE
              (
                ${sortExpr} > $10::bigint
                OR (
                  ${sortExpr} = $10::bigint
                  AND pri.product_id > $11::text
                )
              )
          END
        )
      )
      ORDER BY ${sortAlias} ${safeSort}, pri.product_id ASC
      LIMIT $8
      `,
      [
        userId,
        hasStartDate,
        startDate,
        hasEndDate,
        endDate,
        hasKeyword,
        safeKeyword,
        fetchLimit,
        hasCursor,
        hasCursor ? Number(effectiveCursorValue) : 0,
        hasCursor ? String(cursorProductId) : "",
        safeSort,
      ],
    );

    return {
      items: result.rows,
    };
  },
};

module.exports = productRepository;