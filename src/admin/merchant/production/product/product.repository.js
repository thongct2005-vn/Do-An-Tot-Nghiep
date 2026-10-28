const pool = require("../../../../config/database");

const productRepository = {
  async getTopSellingProducts(
    userId,
    {
      startDate = null,
      endDate = null,
      sortByQuantity = "DESC",
      keyword = null,
      limit = 10,
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

    const safeSort =
      String(sortByQuantity).toUpperCase() === "ASC" ? "ASC" : "DESC";
    const hasCursor =
      cursorQuantity !== null &&
      cursorQuantity !== undefined &&
      Boolean(cursorProductId);

  
    const fetchLimit = limit + 1;

  
    const result = await pool.query(
      `
      SELECT
        pri.product_id,
        MAX(pri.name) AS product_name,
        SUM(pri.quantity)::bigint AS total_quantity_sold,
        SUM(pri.quantity * pri.unit_price)::bigint AS total_revenue
      FROM payment_request_items pri
      JOIN payment_requests pr ON pri.payment_request_id = pr.id
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
                SUM(pri.quantity) < $10::bigint
                OR (
                  SUM(pri.quantity) = $10::bigint
                  AND pri.product_id > $11::text
                )
              )
            ELSE
              (
                SUM(pri.quantity) > $10::bigint
                OR (
                  SUM(pri.quantity) = $10::bigint
                  AND pri.product_id > $11::text
                )
              )
          END
        )
      )
      ORDER BY total_quantity_sold ${safeSort}, pri.product_id ASC
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
        hasCursor ? Number(cursorQuantity) : 0,
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