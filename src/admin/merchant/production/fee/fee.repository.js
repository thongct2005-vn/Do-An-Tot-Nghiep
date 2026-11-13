const { uuidv7 } = require("uuidv7");
const {
  SYSTEM_FEE_WALLET_ID,
  FEE_TYPES,
  MONTHLY_STATUS,
} = require("../../../../modules/fee/feeCalculator");

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

  async getFeeSetting(db, merchantUserId, { forUpdate = false } = {}) {
    const res = await db.query(
      `SELECT merchant_user_id, fee_plan, pending_fee_plan, expires_at, updated_at,
              monthly_plan_enabled, monthly_status, grace_until, overdue_month_key, overdue_amount
         FROM merchant_fee_settings
        WHERE merchant_user_id = $1
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [merchantUserId],
    );
    return res.rows[0] || null;
  },

  async upsertFeeSetting(
    db,
    {
      merchantUserId,
      feePlan,
      pendingFeePlan = null,
      expiresAt = null,
      monthlyPlanEnabled = feePlan === "MONTHLY",
      monthlyStatus = feePlan === "MONTHLY" ? MONTHLY_STATUS.ACTIVE : MONTHLY_STATUS.INACTIVE,
      graceUntil = null,
      overdueMonthKey = null,
      overdueAmount = 0,
    },
  ) {
    const res = await db.query(
      `INSERT INTO merchant_fee_settings (
         merchant_user_id, fee_plan, pending_fee_plan, expires_at, updated_at,
         monthly_plan_enabled, monthly_status, grace_until, overdue_month_key, overdue_amount
       )
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9)
       ON CONFLICT (merchant_user_id) DO UPDATE SET
         fee_plan = EXCLUDED.fee_plan,
         pending_fee_plan = EXCLUDED.pending_fee_plan,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW(),
         monthly_plan_enabled = EXCLUDED.monthly_plan_enabled,
         monthly_status = EXCLUDED.monthly_status,
         grace_until = EXCLUDED.grace_until,
         overdue_month_key = EXCLUDED.overdue_month_key,
         overdue_amount = EXCLUDED.overdue_amount
       RETURNING merchant_user_id, fee_plan, pending_fee_plan, expires_at, updated_at,
                 monthly_plan_enabled, monthly_status, grace_until, overdue_month_key, overdue_amount`,
      [
        merchantUserId,
        feePlan,
        pendingFeePlan,
        expiresAt,
        Boolean(monthlyPlanEnabled),
        monthlyStatus,
        graceUntil,
        overdueMonthKey,
        Math.max(0, Math.trunc(Number(overdueAmount) || 0)),
      ],
    );
    return res.rows[0];
  },

  async getSchedulesForMerchant(db, merchantUserId) {
    if (!merchantUserId) return [];
    const res = await db.query(
      `SELECT id, merchant_user_id, effective_from, rate_bps, min_fee, max_fee,
              max_fee_unbounded, free_threshold_amount,
              transfer_fee_bps, transfer_min_fee, transfer_max_fee, transfer_max_fee_unbounded,
              withdraw_fee_bps, withdraw_free_quota_per_month,
              monthly_plan_enabled, monthly_plan_fee,
              tiers, reason, created_by_actor, created_at
         FROM merchant_fee_schedules
        WHERE merchant_user_id = $1
        ORDER BY effective_from DESC, created_at DESC`,
      [merchantUserId],
    );
    return res.rows;
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

    // Khóa ví SYSTEM_FEE_WALLET trước khi kiểm tra/chèn sổ cái để tránh trùng khi retry hoặc chạy song song
    const walletLockRes = await client.query(
      `SELECT balance
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [SYSTEM_FEE_WALLET_ID],
    );

    if (!walletLockRes.rows[0]) {
      throw new Error(
        `Không tìm thấy ví thu phí hệ thống SYSTEM_FEE_WALLET (${SYSTEM_FEE_WALLET_ID})`,
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
         rate_snapshot, fee_wallet_user_id, fee_wallet_balance_before,
         fee_wallet_balance_after, idempotency_key, created_at
       )
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7::jsonb, $8::uuid, $9, $10, $11, NOW())
       ON CONFLICT (transaction_id, fee_type) DO NOTHING
       RETURNING id`,
      [
        ledgerId,
        String(transactionId),
        merchantUserId || null,
        payerUserId || null,
        feeType,
        feeAmount,
        JSON.stringify(rateSnapshot || {}),
        SYSTEM_FEE_WALLET_ID,
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
      [feeAmount, SYSTEM_FEE_WALLET_ID],
    );

    return {
      credited: true,
      ledgerId: insertRes.rows[0].id,
      feeWalletUserId: SYSTEM_FEE_WALLET_ID,
      balanceBefore,
      balanceAfter,
    };
  },

  /**
   * Trừ tiền gói tháng trong transaction đang khoá user (`FOR UPDATE`).
   * Dùng `idempotency_key` duy nhất theo từng tháng để không bao giờ trừ trùng 2 lần,
   * đồng thời ghi nhận snapshot + cộng vào SYSTEM_FEE_WALLET + fee_ledger_entries.
   */
  async chargeMonthlyFeeTx(
    client,
    { merchantUser, amount, monthLabel, monthKey = null, idempotencyKey, rateSnapshot = null },
  ) {
    const feeAmount = Math.trunc(Number(amount) || 0);
    if (feeAmount <= 0) {
      return { charged: true, skippedZeroAmount: true };
    }

    const existingTx = await client.query(
      `SELECT id FROM transactions WHERE idempotency_key = $1 LIMIT 1`,
      [idempotencyKey],
    );
    if (existingTx.rows[0]) {
      return { charged: true, alreadyCharged: true, transactionId: existingTx.rows[0].id };
    }

    const balanceBefore = Number(merchantUser.balance);
    if (balanceBefore < feeAmount) {
      return {
        charged: false,
        insufficientBalance: true,
        balance: balanceBefore,
        required: feeAmount,
      };
    }

    const balanceAfter = balanceBefore - feeAmount;
    await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
      balanceAfter,
      merchantUser.id,
    ]);

    const snapshot = rateSnapshot || {
      fee_type: FEE_TYPES.MONTHLY_PLAN_FEE,
      month_key: monthKey,
      month_label: monthLabel,
      monthly_plan_fee: feeAmount,
    };

    const txRes = await client.query(
      `INSERT INTO transactions (
         transaction_type,
         source_user_id,
         source_balance_before,
         source_balance_after,
         amount,
         fee,
         merchant_fee,
         fee_rate_snapshot,
         net_amount,
         description,
         idempotency_key,
         status,
         completed_at
       )
       VALUES ('PAYMENT', $1, $2, $3, $4, 0, 0, $5::jsonb, 0, $6, $7, 'SUCCESS', NOW())
       RETURNING id, created_at`,
      [
        merchantUser.id,
        balanceBefore,
        balanceAfter,
        feeAmount,
        JSON.stringify(snapshot),
        `Thu phí gói tháng ${monthLabel}`,
        idempotencyKey,
      ],
    );

    const transactionId = txRes.rows[0].id;
    await this.creditSystemFeeWalletAndLedgerTx(client, {
      transactionId,
      merchantUserId: merchantUser.id,
      payerUserId: merchantUser.id,
      feeType: FEE_TYPES.MONTHLY_PLAN_FEE,
      amount: feeAmount,
      rateSnapshot: snapshot,
      idempotencyKey,
    });

    return {
      charged: true,
      transactionId,
      balanceBefore,
      balanceAfter,
      feeAmount,
      rateSnapshot: snapshot,
    };
  },

  async recordAudit(db, { eventType, payload }) {
    await db.query(
      `INSERT INTO audit_outbox (id, event_type, payload)
       VALUES ($1::uuid, $2, $3::jsonb)`,
      [uuidv7(), eventType, JSON.stringify(payload)],
    );
  },

  async getDueRolloverMerchantIds(db, limit = 100) {
    const res = await db.query(
      `SELECT mfs.merchant_user_id
         FROM merchant_fee_settings mfs
        WHERE (
                mfs.fee_plan = 'MONTHLY'
                OR mfs.pending_fee_plan IS NOT NULL
                OR mfs.monthly_plan_enabled = true
              )
           OR (
                mfs.monthly_status = 'PAST_DUE'
                AND (
                  (mfs.grace_until IS NOT NULL AND mfs.grace_until <= NOW())
                  OR EXISTS (
                    SELECT 1
                      FROM users u
                     WHERE u.id = mfs.merchant_user_id
                       AND u.balance >= mfs.overdue_amount
                  )
                )
              )
           OR (
                mfs.overdue_amount > 0
                AND EXISTS (
                  SELECT 1
                    FROM users u
                   WHERE u.id = mfs.merchant_user_id
                     AND u.balance >= mfs.overdue_amount
                )
              )
        ORDER BY COALESCE(mfs.grace_until, mfs.expires_at, NOW()) ASC
        LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => r.merchant_user_id);
  },
};

module.exports = merchantFeeRepository;
