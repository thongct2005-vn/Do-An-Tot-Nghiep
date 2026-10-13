const pool = require("../../config/database");
const paymentRequestRepository = require("../paymentRequest/paymentRequest.repository");
const { httpError } = require("../../utils/httpError");

const TransactionRepository = {
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
    const [firstId, secondId] = [sourceUserId, destinationUserId].sort();

    const firstUserResult = await client.query(
      `SELECT id, full_name, phone, balance FROM users WHERE id = $1 FOR UPDATE`,
      [firstId],
    );
    const secondUserResult = await client.query(
      `SELECT id, full_name, phone, balance FROM users WHERE id = $1 FOR UPDATE`,
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

    const sourceUser = firstId === sourceUserId ? firstUser : secondUser;
    const destUser = firstId === sourceUserId ? secondUser : firstUser;

    const totalDeduct = Number(amount) + Number(fee);
    const sourceBalanceBefore = Number(sourceUser.balance);

    if (sourceBalanceBefore < totalDeduct) {
      throw httpError(422, "Số dư không đủ để thực hiện giao dịch");
    }

    const sourceBalanceAfter = sourceBalanceBefore - totalDeduct;
    const destBalanceBefore = Number(destUser.balance);
    const destBalanceAfter = destBalanceBefore + Number(amount);

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

  async topupMoney({
    sourceUserId,
    amount,
    fee = 0,
    idempotencyKey,
    transactionType = "TOPUP",
    status = "SUCCESS",
    linkedBankAccountId = null,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const bank = await client.query(
        `SELECT lba.bank_id, b.name
         FROM linked_bank_accounts lba LEFT JOIN banks b ON lba.bank_id = b.id
         WHERE lba.id = $1`,
        [linkedBankAccountId],
      );
      if (!bank.rows[0]) {
        throw httpError(404, "Không tìm thấy ngân hàng liên kết");
      }

      const bankName = bank.rows[0].name;

      const userResult = await client.query(
        `SELECT id, full_name, phone, balance FROM users WHERE id = $1 FOR UPDATE`,
        [sourceUserId],
      );
      const linkedBank = await client.query(
        `SELECT balance FROM linked_bank_accounts WHERE id = $1 FOR UPDATE`,
        [linkedBankAccountId],
      );

      const sourceUser = userResult.rows[0];
      const linkedBankBalance = linkedBank.rows[0]?.balance;

      if (!sourceUser || linkedBankBalance === undefined) {
        throw httpError(
          404,
          "Không tìm thấy số dư của người dùng hoặc tài khoản ngân hàng",
        );
      }

      const totalDeduct = Number(amount) + Number(fee);
      const sourceBalanceBefore = Number(sourceUser.balance);
      const linkedBankBalanceBefore = Number(linkedBankBalance);

      if (linkedBankBalanceBefore < totalDeduct) {
        throw httpError(422, "Số dư ngân hàng không đủ để thực hiện giao dịch");
      }

      const sourceBalanceAfter = sourceBalanceBefore + totalDeduct;
      const linkedBankBalanceAfter = linkedBankBalanceBefore - totalDeduct;

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

  async withdrawnMoney({
    sourceUserId,
    amount,
    fee = 0,
    idempotencyKey,
    transactionType = "WITHDRAW",
    status = "SUCCESS",
    linkedBankAccountId = null,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const bank = await client.query(
        `SELECT lba.bank_id, b.name
         FROM linked_bank_accounts lba LEFT JOIN banks b ON lba.bank_id = b.id
         WHERE lba.id = $1`,
        [linkedBankAccountId],
      );
      if (!bank.rows[0]) {
        throw httpError(404, "Không tìm thấy ngân hàng liên kết");
      }

      const bankName = bank.rows[0].name;

      const userResult = await client.query(
        `SELECT id, full_name, phone, balance FROM users WHERE id = $1 FOR UPDATE`,
        [sourceUserId],
      );
      const linkedBank = await client.query(
        `SELECT balance FROM linked_bank_accounts WHERE id = $1 FOR UPDATE`,
        [linkedBankAccountId],
      );

      const sourceUser = userResult.rows[0];
      const linkedBankBalance = linkedBank.rows[0]?.balance;

      if (!sourceUser || linkedBankBalance === undefined) {
        throw httpError(
          404,
          "Không tìm thấy số dư của người dùng hoặc tài khoản ngân hàng",
        );
      }

      const totalDeduct = Number(amount) + Number(fee);
      const sourceBalanceBefore = Number(sourceUser.balance);
      const linkedBankBalanceBefore = Number(linkedBankBalance);

      if (sourceBalanceBefore < totalDeduct) {
        throw httpError(422, "Số dư tài khoản không đủ để thực hiện giao dịch");
      }

      const sourceBalanceAfter = sourceBalanceBefore - totalDeduct;
      const linkedBankBalanceAfter = linkedBankBalanceBefore + totalDeduct;

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

  async transferMoney(params) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.executeTransfer(client, params);
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
      if (sourceUserId === paymentRequest.destination_user_id) {
        throw httpError(400, "Không thể chuyển tiền cho chính mình");
      }

      const transferResult = await this.executeTransfer(client, {
        sourceUserId: sourceUserId,
        destinationUserId: paymentRequest.destination_user_id,
        amount: paymentRequest.amount,
        description:
          paymentRequest.description || `Thanh toán QR ${referenceCode}`,
        transactionType: transactionType,
        idempotencyKey: idempotencyKey,
      });

      await paymentRequestRepository.markAsPaid(client, {
        referenceCode: referenceCode,
        sourceUserId: sourceUserId,
        transactionId: transferResult.transactionId,
      });

      await client.query("COMMIT");
      return transferResult;
    } catch (e) {
      await client.query("ROLLBACK");
      throw httpError(e?.statusCode ?? 500, e?.message);
    } finally {
      client.release();
    }
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
        CASE WHEN t.source_user_id = $1 THEN 'OUT' ELSE 'IN' END AS direction,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_before ELSE t.dest_balance_before END AS balance_before,
        CASE WHEN t.source_user_id = $1 THEN t.source_balance_after ELSE t.dest_balance_after END AS balance_after
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      WHERE (t.source_user_id = $1 OR t.destination_user_id = $1)
        AND ($2::boolean = false OR t.id < $3)
        AND (
          $5::boolean = false
          OR (
            (t.source_user_id = $1 AND du.full_name ILIKE '%' || $6 || '%')
            OR (t.destination_user_id = $1 AND su.full_name ILIKE '%' || $6 || '%')
            OR t.description ILIKE '%' || $6 || '%'
            OR b.name ILIKE '%' || $6 || '%'
          )
        )
        AND ($7::boolean = false OR t.created_at >= $8)
        AND ($9::boolean = false OR t.created_at <= $10)
      ORDER BY t.id DESC
      LIMIT $4
      `,
      [
        userId,
        hasCursor,
        cursorId,
        limit,
        hasKeyword,
        keyword,
        hasStartDate,
        startDate,
        hasEndDate,
        endDate,
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
          ELSE 0
        END), 0) AS total_expense,
        COALESCE(SUM(CASE
          WHEN transaction_type = 'TOPUP' AND source_user_id = $1 THEN amount
          WHEN transaction_type = 'TRANSFER' AND destination_user_id = $1 THEN amount
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
