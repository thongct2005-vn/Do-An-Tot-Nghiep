const pool = require("../../config/database");
const paymentRequestRepository = require("../paymentRequest/paymentRequest.repository");

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
    const sourceWalletResult = await client.query(
      `SELECT id FROM wallets WHERE user_id = $1`,
      [sourceUserId],
    );
    const destinationWalletResult = await client.query(
      `SELECT id FROM wallets WHERE user_id = $1`,
      [destinationUserId],
    );

    if (!sourceWalletResult.rows[0] || !destinationWalletResult.rows[0]) {
      const err = new Error("Không tìm thấy ví người dùng");
      err.statusCode = 404;
      throw err;
    }

    const sourceWalletId = sourceWalletResult.rows[0].id;
    const destinationWalletId = destinationWalletResult.rows[0].id;

    const [firstId, secondId] = [sourceWalletId, destinationWalletId].sort();

    const firstWalletResult = await client.query(
      `SELECT wallet_id, balance FROM wallet_balances WHERE wallet_id = $1 FOR UPDATE`,
      [firstId],
    );
    const secondWalletResult = await client.query(
      `SELECT wallet_id, balance FROM wallet_balances WHERE wallet_id = $1 FOR UPDATE`,
      [secondId],
    );

    const firstWallet = firstWalletResult.rows[0];
    const secondWallet = secondWalletResult.rows[0];

    if (!firstWallet || !secondWallet) {
      const err = new Error("Không tìm thấy số dư của ví người dùng");
      err.statusCode = 404;
      throw err;
    }

    const sourceWallet =
      firstId === sourceWalletId ? firstWallet : secondWallet;
    const destWallet = firstId === sourceWalletId ? secondWallet : firstWallet;

    const totalDeduct = Number(amount) + Number(fee);
    const sourceBalanceBefore = Number(sourceWallet.balance);

    if (sourceBalanceBefore < totalDeduct) {
      const err = new Error("Số dư không đủ để thực hiện giao dịch");
      err.statusCode = 422;
      throw err;
    }

    const sourceBalanceAfter = sourceBalanceBefore - totalDeduct;
    const destBalanceBefore = Number(destWallet.balance);
    const destBalanceAfter = destBalanceBefore + Number(amount);

    await client.query(
      `UPDATE wallet_balances SET balance = $1 WHERE wallet_id = $2`,
      [sourceBalanceAfter, sourceWalletId],
    );

    await client.query(
      `UPDATE wallet_balances SET balance = $1 WHERE wallet_id = $2`,
      [destBalanceAfter, destinationWalletId],
    );

    const usersResult = await client.query(
      `SELECT id, full_name, phone FROM users WHERE id = ANY($1)`,
      [[sourceUserId, destinationUserId]],
    );

    const sourceUser = usersResult.rows.find((u) => u.id === sourceUserId);
    const destUser = usersResult.rows.find((u) => u.id === destinationUserId);

    if (!sourceUser || !destUser) {
      const err = new Error("Không tìm thấy người gửi hoặc người nhận");
      err.statusCode = 404;
      throw err;
    }
    const insertResult = await client.query(
      `INSERT INTO transactions (
        transaction_type, source_user_id, source_wallet_id, source_balance_before, source_balance_after,
        destination_user_id, destination_wallet_id, dest_balance_before, dest_balance_after,
        amount, fee, description, idempotency_key, status,
        source_display_name, source_display_phone,
        destination_display_name, destination_display_phone
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id, status, created_at`,
      [
        transactionType,
        sourceUserId,
        sourceWalletId,
        sourceBalanceBefore,
        sourceBalanceAfter,
        destinationUserId,
        destinationWalletId,
        destBalanceBefore,
        destBalanceAfter,
        amount,
        fee,
        description,
        idempotencyKey,
        status,
        sourceUser.full_name,
        sourceUser.phone,
        destUser.full_name,
        destUser.phone,
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

  async executeTopup({
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
      const sourceWalletUser = await client.query(
        `SELECT id FROM wallets WHERE user_id = $1`,
        [sourceUserId],
      );

      if (!sourceWalletUser.rows[0]) {
        const err = new Error("Không tìm thấy ví người dùng");
        err.statusCode = 404;
        throw err;
      }

      const bank = await client.query(
        `SELECT lba.bank_id, b.name
      FROM linked_bank_accounts lba LEFT JOIN banks b ON lba.bank_id = b.id
      WHERE lba.id = $1
      `,
        [linkedBankAccountId],
      );
      if (!bank) {
        const err = new Error("Không tìm thấy ngân hàng liên kết");
        err.statusCode = 404;
        throw err;
      }

      const bankName = bank.rows[0].name;

      const sourceWalletId = sourceWalletUser.rows[0].id;

      const sourceWalletResult = await client.query(
        `SELECT wallet_id, balance FROM wallet_balances WHERE wallet_id = $1 FOR UPDATE`,
        [sourceWalletId],
      );
      const linkedBank = await client.query(
        `SELECT balance FROM linked_bank_accounts WHERE id = $1 FOR UPDATE`,
        [linkedBankAccountId],
      );
      const sourceWallet = sourceWalletResult.rows[0];
      const linkedBankBalance =  linkedBank.rows[0].balance;
      if (!sourceWallet) {
        const err = new Error("Không tìm thấy số dư của ví người dùng");
        err.statusCode = 404;
        throw err;
      }

      const totalDeduct = Number(amount) + Number(fee);
      const sourceBalanceBefore = Number(sourceWallet.balance);
      const linkedBankBalanceBefore = Number(linkedBankBalance);
      if (linkedBankBalanceBefore < totalDeduct) {
        const err = new Error(
          "Số dư ngân hàng không đủ để thực hiện giao dịch",
        );
        err.statusCode = 422;
        throw err;
      }

      const sourceBalanceAfter = sourceBalanceBefore + totalDeduct;
      const linkedBankBalanceAfter = linkedBankBalanceBefore - totalDeduct;
      await client.query(
        `UPDATE wallet_balances SET balance = $1 WHERE wallet_id = $2`,
        [sourceBalanceAfter, sourceWalletId],
      );

      await client.query(
        `UPDATE linked_bank_accounts SET balance = $1 WHERE id =$2`,
        [linkedBankBalanceAfter, linkedBankAccountId],
      );

      const sourceUser = await client.query(
        `SELECT id, full_name, phone FROM users WHERE id = $1`,
        [sourceUserId],
      );

      if (!sourceUser) {
        const err = new Error(
          "Không tìm thấy thông tin người thực hiện giao dịch",
        );
        err.statusCode = 404;
        throw err;
      }

      

      const insertResult = await client.query(
        `INSERT INTO transactions (
        transaction_type, source_user_id, source_wallet_id, source_balance_before, source_balance_after,
        amount, fee, idempotency_key, status,
        source_display_name, source_display_phone,
        linked_bank_account_id, bank_name
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id, status, created_at`,
        [
          transactionType,
          sourceUserId,
          sourceWalletId,
          sourceBalanceBefore,
          sourceBalanceAfter,
          amount,
          fee,
          idempotencyKey,
          status,
          sourceUser.full_name,
          sourceUser.phone,
          linkedBankAccountId,
          bankName,
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
        const err = new Error("Không tìm thấy mã QR");
        err.statusCode = 404;
        throw err;
      }
      if (paymentRequest.paid_at != null || paymentRequest.is_expires) {
        const err = new Error("Mã QR này đã được thanh toán hoặc hết hạn");
        err.statusCode = 400;
        throw err;
      }
      if (sourceUserId === paymentRequest.destination_user_id) {
        const err = new Error("Không thể chuyển tiền cho chính mình");
        err.statusCode = 400;
        throw err;
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
      const err = new Error(e);
      err.statusCode = e?.statusCode ?? 500;
      throw err;
    } finally {
      client.release();
    }
  },

  async getTransferHistory(userId, { cursorId = null, limit = 20 } = {}) {
    const hasCursor = Boolean(cursorId);

    const result = await pool.query(
      `
      SELECT
        id,
        transaction_type,
        source_user_id,
        source_display_name,
        source_display_phone,
        destination_user_id,
        destination_display_name,
        destination_display_phone,
        amount,
        fee,
        description,
        status,
        created_at,
        CASE WHEN source_user_id = $1 THEN 'OUT' ELSE 'IN' END AS direction,
        CASE WHEN source_user_id = $1 THEN source_balance_before ELSE dest_balance_before END AS balance_before,
        CASE WHEN source_user_id = $1 THEN source_balance_after ELSE dest_balance_after END AS balance_after
      FROM transactions
      WHERE (source_user_id = $1 OR destination_user_id = $1)
        AND ($2::boolean = false OR id < $3)
      ORDER BY id DESC
      LIMIT $4
      `,
      [userId, hasCursor, cursorId, limit],
    );

    const rows = result.rows;
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    return {
      transaction_list: rows,
      next_cursor: nextCursor,
    };
  },
};

module.exports = TransactionRepository;
