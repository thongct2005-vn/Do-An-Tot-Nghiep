const pool = require("../../../../config/database");
const { httpError } = require("../../../../utils/httpError");
const { assertDailyLimit } = require("../../../../utils/limits/dailyLimit");
const transactionRepository = require("../../../transaction/transaction.repository");

// Giao dịch QR bằng Ví trả sau ghi source_user_id là SYSTEM_POSTPAID_WALLET; join sang
// postpaid_entries (PURCHASE) để hiển thị đúng thông tin người mua và nguồn thanh toán.
const POSTPAID_PAYER_JOIN = `
      LEFT JOIN LATERAL (
        SELECT pe.user_id, u.full_name, u.phone
          FROM postpaid_entries pe
          JOIN users u ON u.id = pe.user_id
         WHERE pe.tx_id = t.id AND pe.action = 'PURCHASE'
         LIMIT 1
      ) pp ON true`;

const FUNDING_SOURCE_SELECT = `'Ví LumaPay'::text AS funding_source`;

function buildMerchantExtraFilters({
  direction = null,
  status = null,
  minAmount = null,
  maxAmount = null,
  fundingSource = null,
  startIndex,
}) {
  const hasDirection = Boolean(direction && String(direction).trim());
  const hasStatus = Boolean(status && String(status).trim());
  const hasMinAmount = minAmount !== null && minAmount !== undefined;
  const hasMaxAmount = maxAmount !== null && maxAmount !== undefined;
  const hasFundingSource = Boolean(fundingSource && String(fundingSource).trim());

  const iDirFlag = startIndex;
  const iDirVal = startIndex + 1;
  const iStatusFlag = startIndex + 2;
  const iStatusVal = startIndex + 3;
  const iMinFlag = startIndex + 4;
  const iMinVal = startIndex + 5;
  const iMaxFlag = startIndex + 6;
  const iMaxVal = startIndex + 7;
  const iFundFlag = startIndex + 8;
  const iFundVal = startIndex + 9;

  const sql = `
        AND (
          $${iDirFlag}::boolean = false
          OR (
            CASE
              WHEN t.transaction_type = 'TOPUP' THEN 'IN'
              WHEN t.source_user_id = $1 THEN 'OUT'
              ELSE 'IN'
            END
          ) = $${iDirVal}::text
        )
        AND ($${iStatusFlag}::boolean = false OR t.status = $${iStatusVal}::text)
        AND ($${iMinFlag}::boolean = false OR t.amount >= $${iMinVal}::bigint)
        AND ($${iMaxFlag}::boolean = false OR t.amount <= $${iMaxVal}::bigint)
        AND (
          $${iFundFlag}::boolean = false
          OR (
            CASE
              WHEN t.linked_bank_account_id IS NOT NULL AND lba.user_id = $1 THEN 'BANK'
              ELSE 'MAIN_WALLET'
            END
          ) = $${iFundVal}::text
        )`;

  const values = [
    hasDirection,
    hasDirection ? String(direction).trim().toUpperCase() : null,
    hasStatus,
    hasStatus ? String(status).trim().toUpperCase() : null,
    hasMinAmount,
    hasMinAmount ? Number(minAmount) : null,
    hasMaxAmount,
    hasMaxAmount ? Number(maxAmount) : null,
    hasFundingSource,
    hasFundingSource ? String(fundingSource).trim().toUpperCase() : null,
  ];

  return { sql, values };
}

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
    return transactionRepository.transferMoney(params);
  },

  async getTransferHistory(
    userId,
    {
      cursorId = null,
      cursorAmount = null,
      limit,
      keyword = null,
      type = null,
      direction = null,
      startDate = null,
      endDate = null,
      sort = "DESC",
      sortBy = "time",
      productId = null,
      status = null,
      minAmount = null,
      maxAmount = null,
      fundingSource = null,
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
    const isIdSort = sortBy === "id";

    const safeKeyword = hasKeyword
      ? keyword.trim().replace(/[\\%_]/g, "\\$&")
      : null;

    const baseParams = [
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
    ];
    const extraFilters = buildMerchantExtraFilters({
      direction,
      status,
      minAmount,
      maxAmount,
      fundingSource,
      startIndex: baseParams.length + 1,
    });
    const params = [...baseParams, ...extraFilters.values];
    const pCursorAmt = `$${params.length + 1}`;
    if (isAmountSort) {
      params.push(hasCursor ? Number(cursorAmount || 0) : 0);
    }

    const cursorClause = isAmountSort
      ? isAsc
        ? `(t.amount > ${pCursorAmt}::bigint OR (t.amount = ${pCursorAmt}::bigint AND (LENGTH(t.id), t.id) < (LENGTH($3::text), $3::text)))`
        : `(t.amount < ${pCursorAmt}::bigint OR (t.amount = ${pCursorAmt}::bigint AND (LENGTH(t.id), t.id) < (LENGTH($3::text), $3::text)))`
      : isIdSort
        ? isAsc
          ? `(LENGTH(t.id), t.id) > (LENGTH($3::text), $3::text)`
          : `(LENGTH(t.id), t.id) < (LENGTH($3::text), $3::text)`
        : isAsc
          ? `(t.created_at, LENGTH(t.id), t.id) > ((SELECT c.created_at FROM transactions c WHERE c.id = $3), LENGTH($3::text), $3::text)`
          : `(t.created_at, LENGTH(t.id), t.id) < ((SELECT c.created_at FROM transactions c WHERE c.id = $3), LENGTH($3::text), $3::text)`;

    const orderByClause = isAmountSort
      ? `t.amount ${isAsc ? "ASC" : "DESC"}, LENGTH(t.id) DESC, t.id DESC`
      : isIdSort
        ? `LENGTH(t.id) ${isAsc ? "ASC" : "DESC"}, t.id ${isAsc ? "ASC" : "DESC"}`
        : `t.created_at ${isAsc ? "ASC" : "DESC"}, LENGTH(t.id) ${isAsc ? "ASC" : "DESC"}, t.id ${isAsc ? "ASC" : "DESC"}`;

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.transaction_type,
        CASE WHEN pp.user_id IS NOT NULL THEN pp.user_id ELSE t.source_user_id END AS source_user_id,
        COALESCE(
          pp.full_name,
          CASE
            WHEN su.full_name = 'SYSTEM_POSTPAID_WALLET' THEN 'Ví trả sau'
            WHEN su.role = 'SYSTEM' THEN 'Hệ thống'
            ELSE su.full_name
          END
        ) AS source_display_name,
        CASE
          WHEN pp.phone IS NOT NULL AND LENGTH(pp.phone) >= 3
          THEN '*********' || RIGHT(pp.phone, 3)
          WHEN pp.phone IS NOT NULL THEN pp.phone
          WHEN su.role = 'SYSTEM' THEN NULL
          WHEN su.phone IS NOT NULL AND LENGTH(su.phone) >= 3
          THEN '*********' || RIGHT(su.phone, 3)
          ELSE su.phone
        END AS source_display_phone,
        
        t.destination_user_id,
        CASE
          WHEN du.full_name = 'SYSTEM_POSTPAID_WALLET' THEN 'Ví trả sau'
          WHEN du.role = 'SYSTEM' THEN 'Hệ thống'
          ELSE du.full_name
        END AS destination_display_name,
        CASE
          WHEN du.role = 'SYSTEM' THEN NULL
          WHEN du.phone IS NOT NULL AND LENGTH(du.phone) >= 3
          THEN '*********' || RIGHT(du.phone, 3)
          ELSE du.phone
        END AS destination_display_phone,

        t.amount,
        t.user_fee AS fee,
        CASE WHEN t.destination_user_id = $1 THEN t.merchant_fee ELSE 0 END AS merchant_fee,
        t.fee_rate_snapshot,
        CASE WHEN t.destination_user_id = $1 THEN (t.amount - COALESCE(t.merchant_fee, 0)) ELSE t.amount END AS net_amount,
        t.description,
        t.status,
        t.created_at,
        b.name AS bank_name,
        pr.order_id AS order_id,
        ${FUNDING_SOURCE_SELECT},
        CASE
          WHEN t.transaction_type = 'TOPUP' THEN 'IN'
          WHEN t.source_user_id = $1 THEN 'OUT'
          ELSE 'IN'
        END AS direction,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_before ELSE t.dest_balance_before END AS balance_before,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_after ELSE t.dest_balance_after END AS balance_after
      FROM transactions t
      ${POSTPAID_PAYER_JOIN}
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      WHERE (t.source_user_id = $1 OR (t.destination_user_id = $1 AND t.status <> 'FAILED'))
        AND ($2::boolean = false OR ${cursorClause})
        AND (
          $5::boolean = false
          OR (
            (t.source_user_id = $1 AND du.full_name ILIKE '%' || $6 || '%')
            OR (t.destination_user_id = $1 AND COALESCE(pp.full_name, su.full_name) ILIKE '%' || $6 || '%')
            OR t.id ILIKE '%' || $6 || '%'
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
        ${extraFilters.sql}
      ORDER BY ${orderByClause}
      LIMIT $4
      `,
      params,
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
    {
      keyword = null,
      type = null,
      direction = null,
      startDate,
      endDate,
      productId = null,
      status = null,
      minAmount = null,
      maxAmount = null,
      fundingSource = null,
      limit = null,
    },
  ) {
    const hasKeyword = Boolean(keyword && keyword.trim());
    const hasType = Boolean(type);
    const hasProductId = Boolean(productId);
    const safeKeyword = hasKeyword
      ? keyword.trim().replace(/[\\%_]/g, "\\$&")
      : null;

    const baseExportParams = [
      userId,
      hasKeyword,
      safeKeyword,
      startDate,
      endDate,
      hasType,
      type,
      limit,
      hasProductId,
      productId,
    ];
    const extraFilters = buildMerchantExtraFilters({
      direction,
      status,
      minAmount,
      maxAmount,
      fundingSource,
      startIndex: baseExportParams.length + 1,
    });

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.transaction_type,
        CASE WHEN pp.user_id IS NOT NULL THEN pp.user_id ELSE t.source_user_id END AS source_user_id,
        COALESCE(
          pp.full_name,
          CASE
            WHEN su.full_name = 'SYSTEM_POSTPAID_WALLET' THEN 'Ví trả sau'
            WHEN su.role = 'SYSTEM' THEN 'Hệ thống'
            ELSE su.full_name
          END
        ) AS source_display_name,
        CASE
          WHEN pp.phone IS NOT NULL AND LENGTH(pp.phone) >= 3
          THEN '*********' || RIGHT(pp.phone, 3)
          WHEN pp.phone IS NOT NULL THEN pp.phone
          WHEN su.role = 'SYSTEM' THEN NULL
          WHEN su.phone IS NOT NULL AND LENGTH(su.phone) >= 3
          THEN '*********' || RIGHT(su.phone, 3)
          ELSE su.phone
        END AS source_display_phone,
        t.destination_user_id,
        CASE
          WHEN du.full_name = 'SYSTEM_POSTPAID_WALLET' THEN 'Ví trả sau'
          WHEN du.role = 'SYSTEM' THEN 'Hệ thống'
          ELSE du.full_name
        END AS destination_display_name,
        CASE
          WHEN du.role = 'SYSTEM' THEN NULL
          WHEN du.phone IS NOT NULL AND LENGTH(du.phone) >= 3
          THEN '*********' || RIGHT(du.phone, 3)
          ELSE du.phone
        END AS destination_display_phone,
        t.amount,
        t.user_fee AS fee,
        CASE WHEN t.destination_user_id = $1 THEN t.merchant_fee ELSE 0 END AS merchant_fee,
        t.fee_rate_snapshot,
        CASE WHEN t.destination_user_id = $1 THEN (t.amount - COALESCE(t.merchant_fee, 0)) ELSE t.amount END AS net_amount,
        t.description,
        t.status,
        t.created_at,
        b.name AS bank_name,
        pr.order_id AS order_id,
        ${FUNDING_SOURCE_SELECT},
        CASE
          WHEN t.transaction_type = 'TOPUP' THEN 'IN'
          WHEN t.source_user_id = $1 THEN 'OUT'
          ELSE 'IN'
        END AS direction,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_before ELSE t.dest_balance_before END AS balance_before,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_after ELSE t.dest_balance_after END AS balance_after
      FROM transactions t
      ${POSTPAID_PAYER_JOIN}
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      WHERE (t.source_user_id = $1 OR (t.destination_user_id = $1 AND t.status <> 'FAILED'))
        AND (
          $2::boolean = false
          OR (
            (t.source_user_id = $1 AND du.full_name ILIKE '%' || $3::text || '%')
            OR (t.destination_user_id = $1 AND COALESCE(pp.full_name, su.full_name) ILIKE '%' || $3::text || '%')
            OR t.id ILIKE '%' || $3::text || '%'
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
        ${extraFilters.sql}
      ORDER BY t.created_at ASC, t.id ASC
      LIMIT $8::int
      `,
      [...baseExportParams, ...extraFilters.values],
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
        t.user_fee AS fee,
        CASE WHEN t.destination_user_id = $1 THEN t.merchant_fee ELSE 0 END AS merchant_fee,
        t.fee_rate_snapshot,
        CASE WHEN t.destination_user_id = $1 THEN (t.amount - COALESCE(t.merchant_fee, 0)) ELSE t.amount END AS net_amount,
        t.description,
        t.created_at,
        t.completed_at,
        CASE WHEN pp.user_id IS NOT NULL THEN pp.user_id ELSE t.source_user_id END AS source_user_id,
        COALESCE(
          pp.full_name,
          CASE
            WHEN su.full_name = 'SYSTEM_POSTPAID_WALLET' THEN 'Ví trả sau'
            WHEN su.role = 'SYSTEM' THEN 'Hệ thống'
            ELSE su.full_name
          END
        ) AS source_full_name,
        CASE
          WHEN pp.phone IS NOT NULL THEN pp.phone
          WHEN su.role = 'SYSTEM' THEN NULL
          ELSE su.phone
        END AS source_phone,
        ${FUNDING_SOURCE_SELECT},
        t.destination_user_id,
        CASE
          WHEN du.full_name = 'SYSTEM_POSTPAID_WALLET' THEN 'Ví trả sau'
          WHEN du.role = 'SYSTEM' THEN 'Hệ thống'
          ELSE du.full_name
        END AS destination_full_name,
        CASE WHEN du.role = 'SYSTEM' THEN NULL ELSE du.phone END AS destination_phone,
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
        (t.linked_bank_account_id IS NOT NULL) AS has_linked_bank,
        pr.id AS payment_request_id,
        pr.order_id,
        pr.reference_code,
        pr.status AS payment_status,
        pr.description AS payment_description,
        pr.paid_at,
        pr.expires_at
      FROM transactions t
      ${POSTPAID_PAYER_JOIN}
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      WHERE t.id = $2
        AND (t.source_user_id = $1 OR (t.destination_user_id = $1 AND t.status <> 'FAILED'))
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
      WHEN transaction_type = 'WITHDRAW' AND source_user_id = $1 THEN amount + user_fee
      WHEN transaction_type = 'TRANSFER' AND source_user_id = $1 THEN amount + user_fee
      WHEN transaction_type = 'PAYMENT' AND source_user_id = $1 THEN amount + user_fee
      ELSE 0
    END), 0) AS total_expense,
    COALESCE(SUM(CASE
      WHEN transaction_type = 'TOPUP' AND source_user_id = $1 THEN amount
      WHEN transaction_type = 'TRANSFER' AND destination_user_id = $1 THEN (amount - COALESCE(merchant_fee, 0))
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

  async getDailyRevenueStats(
    userId,
    { startDate = null, endDate = null } = {},
  ) {
    const hasStartDate = Boolean(startDate);
    const hasEndDate = Boolean(endDate);

    const dailyResult = await pool.query(
      `
      WITH base_tx AS (
        SELECT
          t.id,
          t.created_at,
          t.amount::bigint AS amount,
          COALESCE(t.merchant_fee, 0)::bigint AS merchant_fee,
          LEAST(
            t.amount,
            GREATEST(
              COALESCE((
                SELECT SUM(pe.amount)::bigint
                FROM postpaid_entries pe
                WHERE pe.ref_tx_id = t.id::text
                  AND pe.action = 'REFUND'
              ), 0),
              COALESCE((
                SELECT MAX((r.new_values->>'amount')::bigint)
                FROM admin_user_change_history r
                WHERE r.action = 'ADMIN_OP_REVERSAL'
                  AND (r.new_values->>'original_transaction_id') = t.id::text
              ), 0)
            )
          )::bigint AS refunded_amount
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
      )
      SELECT
        TO_CHAR(b.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS date_str,
        COALESCE(SUM(b.amount - b.merchant_fee - b.refunded_amount), 0)::bigint AS revenue,
        COALESCE(SUM(GREATEST(0, b.amount - b.refunded_amount)), 0)::bigint AS gross_revenue,
        COALESCE(SUM(b.merchant_fee), 0)::bigint AS merchant_fee,
        COUNT(*) FILTER (WHERE b.refunded_amount = 0)::int AS order_count,
        COUNT(*) FILTER (WHERE b.refunded_amount > 0)::int AS refunded_count,
        COALESCE(SUM(b.refunded_amount), 0)::bigint AS refunded_amount,
        COALESCE(SUM(CASE WHEN b.refunded_amount > 0 THEN b.merchant_fee ELSE 0 END), 0)::bigint AS refunded_merchant_fee
      FROM base_tx b
      GROUP BY date_str
      ORDER BY date_str ASC
      `,
      [userId, hasStartDate, startDate, hasEndDate, endDate],
    );

    return dailyResult.rows;
  },

  async getMerchantStats(userId, { startDate = null, endDate = null } = {}) {
    const dailyRows = await this.getDailyRevenueStats(userId, {
      startDate,
      endDate,
    });

    let totalRevenue = 0;
    let grossRevenue = 0;
    let totalMerchantFee = 0;
    let totalOrders = 0;
    let refundedCount = 0;
    let refundedAmount = 0;
    let refundedMerchantFee = 0;

    for (const r of dailyRows) {
      totalRevenue += Number(r.revenue || 0);
      grossRevenue += Number(r.gross_revenue || 0);
      totalMerchantFee += Number(r.merchant_fee || 0);
      totalOrders += Number(r.order_count || 0);
      refundedCount += Number(r.refunded_count || 0);
      refundedAmount += Number(r.refunded_amount || 0);
      refundedMerchantFee += Number(r.refunded_merchant_fee || 0);
    }

    const avgOrderValue =
      totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    return {
      summary: {
        total_revenue: totalRevenue,
        gross_revenue: grossRevenue,
        total_merchant_fee: totalMerchantFee,
        total_orders: totalOrders,
        avg_order_value: avgOrderValue,
        refunded_count: refundedCount,
        refunded_amount: refundedAmount,
        refunded_merchant_fee: refundedMerchantFee,
      },
      daily_stats: dailyRows,
    };
  },
};

module.exports = merchantTransactionRepository;