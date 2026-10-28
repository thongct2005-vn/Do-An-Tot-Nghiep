const pool = require("../../config/database");
const paymentRequestRepository = require("../paymentRequest/paymentRequest.repository");
const webhookRepository = require("../webhook/webhook.repository");
const { httpError } = require("../../utils/httpError");

const TransactionRepository = {
  async checkIdempotencyKey(idempotencyKey) {
    const result = await pool.query(
      `
      SELECT status, response_body, request_hash, response_status_code, actor_id
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

  /**
   * Ghi 1 sự kiện vào audit_outbox (bảng chỉ thêm, không sửa/xoá).
   * Truyền `client` đang nằm trong transaction để "tiền đã đi" và "audit đã ghi" luôn đi cùng nhau:
   * ghi audit lỗi thì cả giao dịch rollback.
   */
  async recordAudit(db, { eventType, payload }) {
    await db.query(
      `INSERT INTO audit_outbox (event_type, payload) VALUES ($1, $2::jsonb)`,
      [eventType, JSON.stringify(payload)],
    );
  },

  /** Ghi audit ngoài transaction (log API). Lỗi ghi log không được làm hỏng request. */
  async recordAuditSafe({ eventType, payload }) {
    try {
      await TransactionRepository.recordAudit(pool, { eventType, payload });
    } catch (e) {
      console.error("Ghi audit thất bại:", e.message);
    }
  },

  /**
   * Giành lại một key đang kẹt để xử lý lại (một câu lệnh nguyên tử, chỉ một request thắng):
   *  - FAILED: lần trước lỗi, cho phép thử lại.
   *  - PENDING quá `staleSeconds`: tiến trình trước có thể đã chết giữa chừng.
   * An toàn tiền bạc vì transactions.idempotency_key là UNIQUE.
   */
  async reclaimIdempotencyKey({ idempotencyKey, staleSeconds = 60 }) {
    const result = await pool.query(
      `UPDATE idempotency_keys
          SET status = 'PENDING', create_at = NOW(),
              response_body = NULL, response_status_code = NULL
        WHERE idempotency_key = $1
          AND (status = 'FAILED'
               OR (status = 'PENDING' AND create_at < NOW() - ($2::int * INTERVAL '1 second')))
        RETURNING idempotency_key`,
      [idempotencyKey, staleSeconds],
    );
    return result.rowCount === 1;
  },

  async executeTransfer(
    client,
    {
      sourceUserId,
      destinationUserId,
      amount,
      fee = 0,
      description,
      idempotencyKey,
      transactionType = "TRANSFER",
      status = "SUCCESS",
    },
  ) {
    const amountNum = Number(amount);
    const feeNum = Number(fee);

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw httpError(400, "Số tiền không hợp lệ");
    }
    if (!Number.isFinite(feeNum) || feeNum < 0) {
      throw httpError(400, "Phí giao dịch không hợp lệ");
    }
    if (String(sourceUserId) === String(destinationUserId)) {
      throw httpError(400, "Không thể chuyển tiền cho chính mình");
    }

    const [firstId, secondId] = [
      String(sourceUserId),
      String(destinationUserId),
    ].sort();

    const firstUserResult = await client.query(
      `SELECT id, full_name, phone, balance, status FROM users WHERE id = $1 FOR UPDATE`,
      [firstId],
    );
    const secondUserResult = await client.query(
      `SELECT id, full_name, phone, balance, status FROM users WHERE id = $1 FOR UPDATE`,
      [secondId],
    );

    const firstUser = firstUserResult.rows[0];
    const secondUser = secondUserResult.rows[0];

    if (!firstUser || !secondUser) {
      throw httpError(
        404,
        "Không tìm thấy thông tin người gửi hoặc người nhận",
      );
    }

    const sourceIsFirst = firstId === String(sourceUserId);
    const sourceUser = sourceIsFirst ? firstUser : secondUser;
    const destUser = sourceIsFirst ? secondUser : firstUser;

    if (sourceUser.status !== "ACTIVE") {
      throw httpError(403, "Tài khoản của bạn đang bị khoá hoặc không khả dụng");
    }
    if (destUser.status !== "ACTIVE") {
      throw httpError(422, "Tài khoản người nhận không khả dụng");
    }

    const totalDeduct = amountNum + feeNum;
    const sourceBalanceBefore = Number(sourceUser.balance);

    if (sourceBalanceBefore < totalDeduct) {
      throw httpError(422, "Số dư không đủ để thực hiện giao dịch");
    }

    const sourceBalanceAfter = sourceBalanceBefore - totalDeduct;
    const destBalanceBefore = Number(destUser.balance);
    const destBalanceAfter = destBalanceBefore + amountNum;

    await client.query(`UPDATE users SET balance = $1 WHERE id = $2`, [
      sourceBalanceAfter,
      sourceUserId,
    ]);

    await client.query(`UPDATE users SET balance = $1 WHERE id = $2`, [
      destBalanceAfter,
      destinationUserId,
    ]);

    const insertResult = await client.query(
      `INSERT INTO transactions (
        transaction_type, source_user_id, source_balance_before, source_balance_after,
        destination_user_id, dest_balance_before, dest_balance_after,
        amount, fee, description, idempotency_key, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, status, created_at`,
      [
        transactionType,
        sourceUserId,
        sourceBalanceBefore,
        sourceBalanceAfter,
        destinationUserId,
        destBalanceBefore,
        destBalanceAfter,
        amount,
        fee,
        description,
        idempotencyKey,
        status,
      ],
    );

    await TransactionRepository.recordAudit(client, {
      eventType: "TRANSACTION_COMPLETED",
      payload: {
        transaction_id: insertResult.rows[0].id,
        transaction_type: transactionType,
        status: insertResult.rows[0].status,
        source_user_id: sourceUserId,
        destination_user_id: destinationUserId,
        amount: amountNum,
        fee: feeNum,
        source_balance_before: sourceBalanceBefore,
        source_balance_after: sourceBalanceAfter,
        dest_balance_before: destBalanceBefore,
        dest_balance_after: destBalanceAfter,
        idempotency_key: idempotencyKey,
      },
    });

    return {
      transactionId: insertResult.rows[0].id,
      status: insertResult.rows[0].status,
      createdAt: insertResult.rows[0].created_at,
      amount,
      fee,
      description,
      sourceUserName: sourceUser?.full_name,
      destinationId: destUser?.id,
      destinationUserName: destUser?.full_name,
      destinationPhone: destUser?.phone,
      sourceBalanceAfter,
      destBalanceAfter,
    };
  },

  async _executeBankTransaction({
    isTopup,
    sourceUserId,
    amount,
    fee = 0,
    idempotencyKey,
    transactionType,
    status = "SUCCESS",
    linkedBankAccountId = null,
  }) {
    const amountNum = Number(amount);
    const feeNum = Number(fee);

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw httpError(400, "Số tiền không hợp lệ");
    }
    if (!Number.isFinite(feeNum) || feeNum < 0) {
      throw httpError(400, "Phí giao dịch không hợp lệ");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `SELECT id, full_name, phone, balance, status FROM users WHERE id = $1 FOR UPDATE`,
        [sourceUserId],
      );
      const sourceUser = userResult.rows[0];
      if (!sourceUser) {
        throw httpError(404, "Không tìm thấy thông tin người dùng");
      }
      if (sourceUser.status !== "ACTIVE") {
        throw httpError(403, "Tài khoản của bạn đang bị khoá hoặc không khả dụng");
      }

      const bankResult = await client.query(
        `SELECT lba.balance, b.name AS bank_name
         FROM linked_bank_accounts lba
         LEFT JOIN banks b ON lba.bank_id = b.id
         WHERE lba.id = $1 AND lba.user_id = $2 AND lba.status = 'ACTIVE'
         FOR UPDATE OF lba`,
        [linkedBankAccountId, sourceUserId],
      );
      const bankRow = bankResult.rows[0];
      if (!bankRow) {
        throw httpError(404, "Không tìm thấy ngân hàng liên kết");
      }

      const bankName = bankRow.bank_name;
      const totalDeduct = amountNum + feeNum;
      const sourceBalanceBefore = Number(sourceUser.balance);
      const linkedBankBalanceBefore = Number(bankRow.balance);

      let sourceBalanceAfter;
      let linkedBankBalanceAfter;

      if (isTopup) {
        if (linkedBankBalanceBefore < totalDeduct) {
          throw httpError(
            422,
            "Số dư ngân hàng không đủ để thực hiện giao dịch",
          );
        }
        sourceBalanceAfter = sourceBalanceBefore + amountNum;
        linkedBankBalanceAfter = linkedBankBalanceBefore - totalDeduct;
      } else {
        if (sourceBalanceBefore < totalDeduct) {
          throw httpError(
            422,
            "Số dư tài khoản không đủ để thực hiện giao dịch",
          );
        }
        sourceBalanceAfter = sourceBalanceBefore - totalDeduct;
        linkedBankBalanceAfter = linkedBankBalanceBefore + totalDeduct;
      }

      await client.query(`UPDATE users SET balance = $1 WHERE id = $2`, [
        sourceBalanceAfter,
        sourceUserId,
      ]);

      await client.query(
        `UPDATE linked_bank_accounts SET balance = $1 WHERE id = $2`,
        [linkedBankBalanceAfter, linkedBankAccountId],
      );

      const insertResult = await client.query(
        `INSERT INTO transactions (
          transaction_type, source_user_id, source_balance_before, source_balance_after,
          amount, fee, idempotency_key, status,
          linked_bank_account_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, status, created_at`,
        [
          transactionType,
          sourceUserId,
          sourceBalanceBefore,
          sourceBalanceAfter,
          amount,
          fee,
          idempotencyKey,
          status,
          linkedBankAccountId,
        ],
      );

      await TransactionRepository.recordAudit(client, {
        eventType: "TRANSACTION_COMPLETED",
        payload: {
          transaction_id: insertResult.rows[0].id,
          transaction_type: transactionType,
          status: insertResult.rows[0].status,
          source_user_id: sourceUserId,
          linked_bank_account_id: linkedBankAccountId,
          amount: amountNum,
          fee: feeNum,
          source_balance_before: sourceBalanceBefore,
          source_balance_after: sourceBalanceAfter,
          linked_bank_balance_before: linkedBankBalanceBefore,
          linked_bank_balance_after: linkedBankBalanceAfter,
          idempotency_key: idempotencyKey,
        },
      });

      await client.query("COMMIT");

      return {
        transactionId: insertResult.rows[0].id,
        status: insertResult.rows[0].status,
        createdAt: insertResult.rows[0].created_at,
        amount,
        fee,
        sourceUserName: sourceUser?.full_name,
        sourceBalanceAfter,
        bankName,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
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
    return TransactionRepository._executeBankTransaction({
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

  async withdrawnMoney({
    sourceUserId,
    amount,
    fee = 0,
    idempotencyKey,
    transactionType = "WITHDRAW",
    status = "SUCCESS",
    linkedBankAccountId = null,
  }) {
    return TransactionRepository._executeBankTransaction({
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
      const result = await TransactionRepository.executeTransfer(
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

  async processQRPayment({
    sourceUserId,
    referenceCode,
    idempotencyKey,
    transactionType,
  }) {
    const client = await pool.connect();
    let transferResult;
    let paymentResult;

    try {
      await client.query("BEGIN");

      const paymentRequest =
        await paymentRequestRepository.findByReferenceCodeForUpdate(
          client,
          referenceCode,
        );
      if (!paymentRequest) {
        throw httpError(404, "Không tìm thấy mã QR");
      }
      if (paymentRequest.paid_at != null || paymentRequest.is_expires) {
        throw httpError(400, "Mã QR này đã được thanh toán hoặc hết hạn");
      }
      if (String(sourceUserId) === String(paymentRequest.destination_user_id)) {
        throw httpError(400, "Không thể chuyển tiền cho chính mình");
      }

      transferResult = await TransactionRepository.executeTransfer(client, {
        sourceUserId: sourceUserId,
        destinationUserId: paymentRequest.destination_user_id,
        amount: paymentRequest.amount,
        description:
          paymentRequest.description || `Thanh toán QR ${referenceCode}`,
        transactionType: transactionType,
        idempotencyKey: idempotencyKey,
      });

      paymentResult = await paymentRequestRepository.markAsPaid(client, {
        referenceCode: referenceCode,
        sourceUserId: sourceUserId,
        transactionId: transferResult.transactionId,
      });
      if (!paymentResult) {
        throw httpError(409, "Mã QR này đã được thanh toán hoặc hết hạn");
      }

      await webhookRepository.enqueue(client, {
        paymentRequestId: paymentResult.id,
        eventType: "payment.success",
      });

      await TransactionRepository.recordAudit(client, {
        eventType: "PAYMENT_PAID",
        payload: {
          payment_id: paymentResult.id,
          order_id: paymentResult.order_id ?? null,
          merchant_id: paymentResult.destination_user_id,
          payer_user_id: sourceUserId,
          transaction_id: transferResult.transactionId,
          amount: Number(paymentResult.amount),
        },
      });

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return transferResult;
  },

  async getTransferHistory(
    userId,
    {
      cursorId = null,
      limit = 20,
      keyword = null,
      startDate = null,
      endDate = null,
    } = {},
  ) {
    const hasCursor = Boolean(cursorId);
    const hasKeyword = Boolean(keyword && keyword.trim());
    const hasStartDate = Boolean(startDate);
    const hasEndDate = Boolean(endDate);

    const safeKeyword = hasKeyword
      ? keyword.trim().replace(/[\\%_]/g, "\\$&")
      : null;

    const endDateOnly =
      hasEndDate &&
      typeof endDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim());

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.transaction_type,
        t.source_user_id,
        su.full_name AS source_display_name,
        su.phone AS source_display_phone,
        
        t.destination_user_id,
        du.full_name AS destination_display_name,
        du.phone AS destination_display_phone,

        t.amount,
        t.fee,
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
        AND ($2::boolean = false OR t.id < $3)
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
        AND ($7::boolean = false OR t.created_at >= $8)
        AND (
          $9::boolean = false
          OR ($11::boolean AND t.created_at < ($10::text)::date + 1)
          OR (NOT $11::boolean AND t.created_at <= ($10::text)::timestamptz)
        )
      ORDER BY t.id DESC
      LIMIT $4
      `,
      [
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
        endDateOnly,
      ],
    );

    const rows = result.rows;
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    return {
      transaction_list: rows,
      next_cursor: nextCursor,
    };
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
      WHEN transaction_type = 'PAYMENT' AND destination_user_id = $1 THEN amount
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
};

module.exports = TransactionRepository;