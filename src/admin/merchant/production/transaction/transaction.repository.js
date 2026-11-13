const pool = require("../../../../config/database");
const { httpError } = require("../../../../utils/httpError");
const { assertDailyLimit } = require("../../../../utils/dailyLimit");
const transactionRepository = require("../../../../modules/transaction/transaction.repository");

const merchantTransactionRepository = {
  async checkIdempotencyKey(idempotencyKey) {
    const result = await pool.query(
      `
      SELECT status, response_body, request_hash, response_status_code
      FROM idempotency_keys WHERE idempotency_key = $1
      `,
      [idempotencyKey],
    );
    return result.rows[0];
  },

  async createIdempotencyKey({
    idempotencyKey,
    actorId,
    actorType,
    requestPath,
    requestHash,
  }) {
    await pool.query(
      `INSERT INTO idempotency_keys
        (idempotency_key, actor_id, actor_type, request_path, request_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [idempotencyKey, actorId, actorType, requestPath, requestHash],
    );
  },

  async updateIdempotencyKey({
    idempotencyKey,
    status,
    responseBody,
    responseStatusCode,
  }) {
    await pool.query(
      `UPDATE idempotency_keys
         SET status = $1, response_body = $2, response_status_code = $3
         WHERE idempotency_key = $4
         `,
      [status, responseBody, responseStatusCode, idempotencyKey],
    );
  },

  async executeTransfer(client, params) {
    return transactionRepository.executeTransfer(client, params);
  },

  async _executeBankTransaction(params) {
    return transactionRepository._executeBankTransaction(params);
  },

  async topupMoney({
    sourceUserId,
    amount,
    fee = 0,
    idempotencyKey,
    transactionType = "TOPUP",
    status = "SUCCESS",
    linkedBankAccountId = null,
  }) {
    return merchantTransactionRepository._executeBankTransaction({
      isTopup: true,
      sourceUserId,
      amount,
      fee,
      idempotencyKey,
      transactionType,
      status,
      linkedBankAccountId,
    });
  },

  async withdrawMoney({
    sourceUserId,
    amount,
    fee = 0,
    idempotencyKey,
    transactionType = "WITHDRAW",
    status = "SUCCESS",
    linkedBankAccountId = null,
  }) {
    return merchantTransactionRepository._executeBankTransaction({
      isTopup: false,
      sourceUserId,
      amount,
      fee,
      idempotencyKey,
      transactionType,
      status,
      linkedBankAccountId,
    });
  },

  async transferMoney(params) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await merchantTransactionRepository.executeTransfer(
        client,
        params,
      );
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async processQRPayment(params) {
    return transactionRepository.processQRPayment(params);
  },

  async getTransferHistory(
    userId,
    {
      cursorId = null,
      cursorAmount = null,
      limit,
      keyword = null,
      type = null,
      startDate = null,
      endDate = null,
      sort = "DESC",
      sortBy = "time",
      productId = null,
    } = {},
  ) {
    const hasCursor = Boolean(cursorId);
    const hasKeyword = Boolean(keyword && keyword.trim());
    const hasType = Boolean(type);
    const hasStartDate = Boolean(startDate);
    const hasEndDate = Boolean(endDate);
    const hasProductId = Boolean(productId);
    const isAsc = String(sort).toUpperCase() === "ASC";
    const isAmountSort = sortBy === "amount";

    const safeKeyword = hasKeyword
      ? keyword.trim().replace(/[\\%_]/g, "\\$&")
      : null;

    const cursorClause = isAmountSort
      ? isAsc
        ? `(t.amount > $15::bigint OR (t.amount = $15::bigint AND t.id < $3))`
        : `(t.amount < $15::bigint OR (t.amount = $15::bigint AND t.id < $3))`
      : isAsc
        ? `t.id > $3`
        : `t.id < $3`;

    const orderByClause = isAmountSort
      ? `t.amount ${isAsc ? "ASC" : "DESC"}, t.id DESC`
      : `t.id ${isAsc ? "ASC" : "DESC"}`;

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.transaction_type,
        t.source_user_id,
        su.full_name AS source_display_name,
        CASE 
          WHEN su.phone IS NOT NULL AND LENGTH(su.phone) >= 3 
          THEN '*********' || RIGHT(su.phone, 3)
          ELSE su.phone 
        END AS source_display_phone,
        
        t.destination_user_id,
        du.full_name AS destination_display_name,
        CASE 
          WHEN du.phone IS NOT NULL AND LENGTH(du.phone) >= 3 
          THEN '*********' || RIGHT(du.phone, 3)
          ELSE du.phone 
        END AS destination_display_phone,

        t.amount,
        t.fee,
        CASE WHEN t.destination_user_id = $1 THEN t.merchant_fee ELSE 0 END AS merchant_fee,
        t.fee_rate_snapshot,
        COALESCE(
          t.net_amount,
          CASE WHEN t.destination_user_id = $1 THEN (t.amount - COALESCE(t.merchant_fee, 0)) ELSE t.amount END
        ) AS net_amount,
        t.description,
        t.status,
        t.created_at,
        b.name AS bank_name,
        pr.order_id AS order_id,
        CASE
          WHEN t.transaction_type = 'TOPUP' THEN 'IN'
          WHEN t.source_user_id = $1 THEN 'OUT'
          ELSE 'IN'
        END AS direction,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_before ELSE t.dest_balance_before END AS balance_before,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_after ELSE t.dest_balance_after END AS balance_after
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      WHERE (t.source_user_id = $1 OR t.destination_user_id = $1)
        AND ($2::boolean = false OR ${cursorClause})
        AND (
          $5::boolean = false
          OR (
            (t.source_user_id = $1 AND du.full_name ILIKE '%' || $6 || '%')
            OR (t.destination_user_id = $1 AND su.full_name ILIKE '%' || $6 || '%')
            OR t.description ILIKE '%' || $6 || '%'
            OR b.name ILIKE '%' || $6 || '%'
            OR pr.order_id ILIKE '%' || $6 || '%'
          )
        )
        AND (
          $7::boolean = false
          OR t.created_at >= (($8::text)::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
        )
        AND (
          $9::boolean = false
          OR t.created_at < ((($10::text)::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        )
        AND (
          $11::boolean = false
          OR t.transaction_type = ($12::text)::transaction_type_enum
        )
        AND (
          $13::boolean = false
          OR EXISTS (
            SELECT 1
            FROM payment_request_items pri
            WHERE pri.payment_request_id = pr.id
              AND pri.product_id = $14::text
          )
        )
      ORDER BY ${orderByClause}
      LIMIT $4
      `,
      isAmountSort
        ? [
            userId,
            hasCursor,
            cursorId,
            limit,
            hasKeyword,
            safeKeyword,
            hasStartDate,
            startDate,
            hasEndDate,
            endDate,
            hasType,
            type,
            hasProductId,
            productId,
            hasCursor ? Number(cursorAmount || 0) : 0,
          ]
        : [
            userId,
            hasCursor,
            cursorId,
            limit,
            hasKeyword,
            safeKeyword,
            hasStartDate,
            startDate,
            hasEndDate,
            endDate,
            hasType,
            type,
            hasProductId,
            productId,
          ],
    );

    const rows = result.rows;
    const lastRow = rows.length === limit ? rows[rows.length - 1] : null;
    const nextCursor = lastRow
      ? isAmountSort
        ? `${lastRow.amount}:${lastRow.id}`
        : lastRow.id
      : null;

    return {
      transaction_list: rows,
      next_cursor: nextCursor,
    };
  },

  /**
   * Lấy toàn bộ giao dịch của merchant trong khoảng ngày (giờ VN) để xuất Excel, cũ -> mới.
   * Không phân trang; service truyền limit = MAX_ROWS + 1 để biết có vượt giới hạn hay không.
   */
  async exportHistory(
    userId,
    { keyword = null, type = null, startDate, endDate, productId = null, limit = null },
  ) {
    const hasKeyword = Boolean(keyword && keyword.trim());
    const hasType = Boolean(type);
    const hasProductId = Boolean(productId);
    const safeKeyword = hasKeyword
      ? keyword.trim().replace(/[\\%_]/g, "\\$&")
      : null;

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.transaction_type,
        t.source_user_id,
        su.full_name AS source_display_name,
        CASE
          WHEN su.phone IS NOT NULL AND LENGTH(su.phone) >= 3
          THEN '*********' || RIGHT(su.phone, 3)
          ELSE su.phone
        END AS source_display_phone,
        t.destination_user_id,
        du.full_name AS destination_display_name,
        CASE
          WHEN du.phone IS NOT NULL AND LENGTH(du.phone) >= 3
          THEN '*********' || RIGHT(du.phone, 3)
          ELSE du.phone
        END AS destination_display_phone,
        t.amount,
        t.fee,
        CASE WHEN t.destination_user_id = $1 THEN t.merchant_fee ELSE 0 END AS merchant_fee,
        t.fee_rate_snapshot,
        COALESCE(
          t.net_amount,
          CASE WHEN t.destination_user_id = $1 THEN (t.amount - COALESCE(t.merchant_fee, 0)) ELSE t.amount END
        ) AS net_amount,
        t.description,
        t.status,
        t.created_at,
        b.name AS bank_name,
        pr.order_id AS order_id,
        CASE
          WHEN t.transaction_type = 'TOPUP' THEN 'IN'
          WHEN t.source_user_id = $1 THEN 'OUT'
          ELSE 'IN'
        END AS direction,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_before ELSE t.dest_balance_before END AS balance_before,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_after ELSE t.dest_balance_after END AS balance_after
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      WHERE (t.source_user_id = $1 OR t.destination_user_id = $1)
        AND (
          $2::boolean = false
          OR (
            (t.source_user_id = $1 AND du.full_name ILIKE '%' || $3::text || '%')
            OR (t.destination_user_id = $1 AND su.full_name ILIKE '%' || $3::text || '%')
            OR t.description ILIKE '%' || $3::text || '%'
            OR b.name ILIKE '%' || $3::text || '%'
            OR pr.order_id ILIKE '%' || $3::text || '%'
          )
        )
        AND t.created_at >= (($4::text)::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
        AND t.created_at < ((($5::text)::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND (
          $6::boolean = false
          OR t.transaction_type = ($7::text)::transaction_type_enum
        )
        AND (
          $9::boolean = false
          OR EXISTS (
            SELECT 1
            FROM payment_request_items pri
            WHERE pri.payment_request_id = pr.id
              AND pri.product_id = $10::text
          )
        )
      ORDER BY t.created_at ASC, t.id ASC
      LIMIT $8::int
      `,
      [userId, hasKeyword, safeKeyword, startDate, endDate, hasType, type, limit, hasProductId, productId],
    );

    return result.rows;
  },

  async getTransactionDetail(userId, transactionId) {
    const result = await pool.query(
      `
      SELECT
        t.id,
        t.transaction_type,
        t.status,
        t.amount,
        t.fee,
        CASE WHEN t.destination_user_id = $1 THEN t.merchant_fee ELSE 0 END AS merchant_fee,
        t.fee_rate_snapshot,
        COALESCE(
          t.net_amount,
          CASE WHEN t.destination_user_id = $1 THEN (t.amount - COALESCE(t.merchant_fee, 0)) ELSE t.amount END
        ) AS net_amount,
        t.description,
        t.created_at,
        t.completed_at,
        t.source_user_id,
        su.full_name AS source_full_name,
        su.phone AS source_phone,
        t.destination_user_id,
        du.full_name AS destination_full_name,
        du.phone AS destination_phone,
        CASE
          WHEN t.transaction_type = 'TOPUP' THEN 'IN'
          WHEN t.source_user_id = $1 THEN 'OUT'
          ELSE 'IN'
        END AS direction,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_before ELSE t.dest_balance_before END AS balance_before,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_after ELSE t.dest_balance_after END AS balance_after,
        b.name AS bank_name,
        b.code AS bank_code,
        b.logo_url AS bank_logo_url,
        lba.account_number,
        lba.account_holder_name,
        pr.id AS payment_request_id,
        pr.order_id,
        pr.reference_code,
        pr.status AS payment_status,
        pr.description AS payment_description,
        pr.paid_at,
        pr.expires_at
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      WHERE t.id = $2
        AND (t.source_user_id = $1 OR t.destination_user_id = $1)
      `,
      [userId, transactionId],
    );
    return result.rows[0];
  },

  async getPaymentItems(paymentRequestId) {
    const result = await pool.query(
      `
      SELECT product_id, name, quantity, unit_price, description
      FROM payment_request_items
      WHERE payment_request_id = $1
      ORDER BY product_id, name
      `,
      [paymentRequestId],
    );
    return result.rows;
  },

  async getCurrentMonthSummary(userId) {
    const result = await pool.query(
      `
     SELECT
    COALESCE(SUM(CASE
      WHEN transaction_type = 'WITHDRAW' AND source_user_id = $1 THEN amount + fee
      WHEN transaction_type = 'TRANSFER' AND source_user_id = $1 THEN amount + fee
      WHEN transaction_type = 'PAYMENT' AND source_user_id = $1 THEN amount + fee
      ELSE 0
    END), 0) AS total_expense,
    COALESCE(SUM(CASE
      WHEN transaction_type = 'TOPUP' AND source_user_id = $1 THEN amount
      WHEN transaction_type = 'TRANSFER' AND destination_user_id = $1 THEN amount
      WHEN transaction_type = 'PAYMENT' AND destination_user_id = $1 THEN (amount - COALESCE(merchant_fee, 0))
      ELSE 0
    END), 0) AS total_income
  FROM transactions
  WHERE (source_user_id = $1 OR destination_user_id = $1)
    AND status = 'SUCCESS'
    AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)
      `,
      [userId],
    );

    const row = result.rows[0];
    return {
      total_income: Number(row.total_income),
      total_expense: Number(row.total_expense),
    };
  },

  async getMerchantStats(userId, { startDate = null, endDate = null } = {}) {
    const hasStartDate = Boolean(startDate);
    const hasEndDate = Boolean(endDate);

    const result = await pool.query(
      `
      SELECT
        -- Tổng doanh thu thực nhận sau phí: PAYMENT thành công mà merchant là bên nhận
        COALESCE(SUM(CASE 
          WHEN t.transaction_type = 'PAYMENT' AND t.destination_user_id = $1 AND t.status = 'SUCCESS' 
          THEN (t.amount - COALESCE(t.merchant_fee, 0)) ELSE 0 
        END), 0) AS total_revenue,

        -- Tổng doanh thu gộp trước phí (tổng tiền khách thanh toán)
        COALESCE(SUM(CASE 
          WHEN t.transaction_type = 'PAYMENT' AND t.destination_user_id = $1 AND t.status = 'SUCCESS' 
          THEN t.amount ELSE 0 
        END), 0) AS gross_revenue,

        -- Tổng phí giao dịch đã khấu trừ của merchant
        COALESCE(SUM(CASE 
          WHEN t.transaction_type = 'PAYMENT' AND t.destination_user_id = $1 AND t.status = 'SUCCESS' 
          THEN COALESCE(t.merchant_fee, 0) ELSE 0 
        END), 0) AS total_merchant_fee,
        
        -- Tổng số đơn hàng thành công
        COUNT(CASE 
          WHEN t.transaction_type = 'PAYMENT' AND t.destination_user_id = $1 AND t.status = 'SUCCESS' 
          THEN 1 ELSE NULL 
        END) AS total_orders,

        -- Giá trị thực nhận trung bình mỗi đơn
        COALESCE(AVG(CASE 
          WHEN t.transaction_type = 'PAYMENT' AND t.destination_user_id = $1 AND t.status = 'SUCCESS' 
          THEN (t.amount - COALESCE(t.merchant_fee, 0)) ELSE NULL 
        END), 0) AS avg_order_value
      FROM transactions t
      WHERE (t.source_user_id = $1 OR t.destination_user_id = $1)
        AND (
          $2::boolean = false
          OR t.created_at >= (($3::text)::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
        )
        AND (
          $4::boolean = false
          OR t.created_at < ((($5::text)::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        )
      `,
      [userId, hasStartDate, startDate, hasEndDate, endDate],
    );
    const dailyResult = await pool.query(
      `
      SELECT
        TO_CHAR(t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS date_str,
        COALESCE(SUM(t.amount - COALESCE(t.merchant_fee, 0)), 0) AS revenue,
        COALESCE(SUM(t.amount), 0) AS gross_revenue,
        COALESCE(SUM(COALESCE(t.merchant_fee, 0)), 0) AS merchant_fee,
        COUNT(t.id) AS order_count
      FROM transactions t
      WHERE t.destination_user_id = $1
        AND t.transaction_type = 'PAYMENT'
        AND t.status = 'SUCCESS'
        AND (
          $2::boolean = false
          OR t.created_at >= (($3::text)::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
        )
        AND (
          $4::boolean = false
          OR t.created_at < ((($5::text)::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        )
      GROUP BY date_str
      ORDER BY date_str ASC
      `,
      [userId, hasStartDate, startDate, hasEndDate, endDate],
    );

    return {
      summary: result.rows[0],
      daily_stats: dailyResult.rows,
    };
  },
};

module.exports = merchantTransactionRepository;