const { uuidv7 } = require("uuidv7");
const {
  assertSystemFeeWalletConfigured,
} = require("../../../fee/feeCalculator");

const merchantFeeRepository = {
  async getMerchantUser(db, merchantUserId, { forUpdate = false } = {}) {
    const res = await db.query(
      `SELECT id, role, status, balance
         FROM users
        WHERE id = $1
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [merchantUserId],
    );
    return res.rows[0] || null;
  },

  async getMonthlyUsage(db, userId, monthKey, { forUpdate = false } = {}) {
    const res = await db.query(
      `SELECT user_id, month_key, withdrawn_amount, qr_gross_amount, updated_at
         FROM merchant_monthly_usage
        WHERE user_id = $1 AND month_key = $2
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [userId, monthKey],
    );
    return res.rows[0] || {
      user_id: userId,
      month_key: monthKey,
      withdrawn_amount: 0,
      qr_gross_amount: 0,
    };
  },

  async ensureAndLockMonthlyUsageTx(client, { userId, monthKey }) {
    await client.query(
      `INSERT INTO merchant_monthly_usage (user_id, month_key, withdrawn_amount, qr_gross_amount)
       VALUES ($1, $2, 0, 0)
       ON CONFLICT (user_id, month_key) DO NOTHING`,
      [userId, monthKey],
    );
    return this.getMonthlyUsage(client, userId, monthKey, { forUpdate: true });
  },

  async addMonthlyUsageTx(client, { userId, monthKey, withdrawDelta = 0, qrGrossDelta = 0 }) {
    const wDelta = Math.max(0, Math.trunc(Number(withdrawDelta) || 0));
    const qDelta = Math.max(0, Math.trunc(Number(qrGrossDelta) || 0));
    if (wDelta === 0 && qDelta === 0) return null;

    const res = await client.query(
      `INSERT INTO merchant_monthly_usage (user_id, month_key, withdrawn_amount, qr_gross_amount, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, month_key) DO UPDATE SET
         withdrawn_amount = merchant_monthly_usage.withdrawn_amount + EXCLUDED.withdrawn_amount,
         qr_gross_amount = merchant_monthly_usage.qr_gross_amount + EXCLUDED.qr_gross_amount,
         updated_at = NOW()
       RETURNING user_id, month_key, withdrawn_amount, qr_gross_amount, updated_at`,
      [userId, monthKey, wDelta, qDelta],
    );
    return res.rows[0];
  },

  /**
   * Ghi nhận tiền phí vào ví hệ thống SYSTEM_FEE_WALLET (khoá cuối cùng trong transaction
   * để tránh tranh chấp/deadlock với ví người dùng) và chèn sổ cái idempotent theo (transaction_id, fee_type).
   */
  async creditSystemFeeWalletAndLedgerTx(
    client,
    {
      transactionId,
      merchantUserId = null,
      payerUserId = null,
      feeType,
      amount,
      rateSnapshot = {},
      idempotencyKey = null,
    },
  ) {
    const feeAmount = Math.trunc(Number(amount) || 0);
    if (feeAmount <= 0) {
      return { credited: false, skippedZeroFee: true };
    }
    if (!transactionId) {
      throw new Error("creditSystemFeeWalletAndLedgerTx: thiếu transactionId");
    }

    const { walletId: feeWalletId } = assertSystemFeeWalletConfigured();

    // Khóa ví SYSTEM_FEE_WALLET trước khi kiểm tra/chèn sổ cái để tránh trùng khi retry hoặc chạy song song
    const walletLockRes = await client.query(
      `SELECT balance
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [feeWalletId],
    );

    if (!walletLockRes.rows[0]) {
      throw new Error(
        `Không tìm thấy ví thu phí hệ thống SYSTEM_FEE_WALLET (${feeWalletId})`,
      );
    }

    const existing = await client.query(
      `SELECT id
         FROM fee_ledger_entries
        WHERE transaction_id = $1 AND fee_type = $2
        LIMIT 1`,
      [String(transactionId), feeType],
    );
    if (existing.rows[0]) {
      return { credited: false, alreadyRecorded: true, ledgerId: existing.rows[0].id };
    }

    const balanceBefore = Number(walletLockRes.rows[0].balance);
    const balanceAfter = balanceBefore + feeAmount;
    const ledgerId = uuidv7();

    const insertRes = await client.query(
      `INSERT INTO fee_ledger_entries (
         id, transaction_id, merchant_user_id, payer_user_id, fee_type, amount,
         fee_wallet_user_id, fee_wallet_balance_before,
         fee_wallet_balance_after, idempotency_key, created_at
       )
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7::uuid, $8, $9, $10, NOW())
       ON CONFLICT (transaction_id, fee_type) DO NOTHING
       RETURNING id`,
      [
        ledgerId,
        String(transactionId),
        merchantUserId || null,
        payerUserId || null,
        feeType,
        feeAmount,
        feeWalletId,
        balanceBefore,
        balanceAfter,
        idempotencyKey || null,
      ],
    );

    if (!insertRes.rows[0]) {
      return { credited: false, alreadyRecorded: true, ledgerId: null };
    }

    await client.query(
      `UPDATE users
          SET balance = balance + $1,
              updated_at = NOW()
        WHERE id = $2`,
      [feeAmount, feeWalletId],
    );

    return {
      credited: true,
      ledgerId: insertRes.rows[0].id,
      feeWalletUserId: feeWalletId,
      balanceBefore,
      balanceAfter,
    };
  },

  async recordAudit(db, { eventType, payload }) {
    await db.query(
      `INSERT INTO audit_outbox (id, event_type, payload)
       VALUES ($1::uuid, $2, $3::jsonb)`,
      [uuidv7(), eventType, JSON.stringify(payload)],
    );
  },
};

module.exports = merchantFeeRepository;
