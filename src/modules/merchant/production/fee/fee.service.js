// fee.service.js: Nghiệp vụ cấu hình, tính phí giao dịch/rút tiền lũy tiến và xem trước biểu phí Merchant.
const pool = require("../../../../config/database");
const { httpError } = require("../../../../utils/common/http");
const { getSystemConfig } = require("../../../../utils/limits/limitsDb");
const merchantFeeRepository = require("./fee.repository");
const {
  FEE_TYPES,
  normalizeSystemFeeConfig,
  mergeEffectiveFeeConfig,
  pickEffectiveSchedule,
  calculatePerTransactionFeeDetails,
  calculateWithdrawFeeDetails,
  previewFeeCalculation,
  getVnMonthMeta,
} = require("../../../fee/feeCalculator");
const {
  FEE_PLANS,
  PLAN_NAMES,
  assertActiveMerchantRow,
  normalizeRequestedPlan,
  formatPlanList,
  buildStatusResponse,
} = require("./fee.helpers");

const merchantFeeService = {
  FEE_PLANS,
  PLAN_NAMES,
  FEE_TYPES,
  getVnMonthMeta,
  normalizeRequestedPlan,

  /**
   * Wrapper tương thích ngược: tính phí 1 giao dịch QR theo config đã truyền vào.
   */
  calculatePerTransactionFee(amount, feeConfig) {
    return calculatePerTransactionFeeDetails(amount, feeConfig).fee_amount;
  },

  async getSystemFeeConfig(role = "MERCHANT", db = pool) {
    const key =
      String(role || "").toUpperCase() === "USER"
        ? "USER_FEE_CONFIG"
        : "MERCHANT_FEE_CONFIG";
    const raw = await getSystemConfig(key, db);
    return normalizeSystemFeeConfig(raw, role);
  },

  async getFeeConfig(db = pool) {
    return this.getSystemFeeConfig("MERCHANT", db);
  },

  /**
   * Giải mã cấu hình hiệu lực cho user hoặc merchant (lấy trực tiếp từ system default).
   */
  async resolveEffectiveFeeConfig(
    userId,
    { role = "MERCHANT", atDate = new Date(), db = pool } = {},
  ) {
    const normalizedRole = String(role || "MERCHANT").toUpperCase();
    const systemConfig = await this.getSystemFeeConfig(normalizedRole, db);
    const effectiveConfig = mergeEffectiveFeeConfig(systemConfig, null, normalizedRole);

    return {
      systemConfig,
      effectiveConfig,
      effectiveSchedule: null,
      upcomingSchedule: null,
    };
  },

  async getWithdrawQuotaStatus(
    userId,
    { role = "USER", nowMs = Date.now(), db = pool, forUpdate = false } = {},
  ) {
    const vnMeta = getVnMonthMeta(nowMs);
    const { effectiveConfig, effectiveSchedule, upcomingSchedule } =
      await this.resolveEffectiveFeeConfig(userId, {
        role,
        atDate: new Date(nowMs),
        db,
      });

    let usage = { withdrawn_amount: 0, qr_gross_amount: 0 };
    if (userId) {
      usage = forUpdate
        ? await merchantFeeRepository.ensureAndLockMonthlyUsageTx(db, {
          userId,
          monthKey: vnMeta.currentMonthKey,
        })
        : await merchantFeeRepository.getMonthlyUsage(
          db,
          userId,
          vnMeta.currentMonthKey,
        );
    }

    const quota = effectiveConfig.withdraw_free_quota_per_month;
    const alreadyWithdrawn = Number(usage?.withdrawn_amount ?? 0);
    const remainingFreeQuota = Math.max(0, quota - alreadyWithdrawn);

    return {
      month_key: vnMeta.currentMonthKey,
      month: vnMeta.currentMonth,
      quota_per_month: quota,
      already_withdrawn: alreadyWithdrawn,
      remaining_free_quota: remainingFreeQuota,
      withdraw_fee_bps: effectiveConfig.withdraw_fee_bps,
      withdraw_fee_percent: effectiveConfig.withdraw_fee_percent,
      effectiveConfig,
      effectiveSchedule,
      upcomingSchedule,
    };
  },

  async getPublicFeePlans() {
    const feeConfig = await this.getFeeConfig();
    return {
      default_plan: "PER_TRANSACTION",
      available_plans: formatPlanList(feeConfig, null, null),
      config: feeConfig,
    };
  },

  async initFeeSettingOnRegisterTx(
    client,
    { merchantUserId, feePlan },
  ) {
    // Đăng ký mới luôn áp dụng biểu phí PER_TRANSACTION
    if (feePlan !== undefined && feePlan !== null && String(feePlan).trim() !== "") {
      normalizeRequestedPlan(feePlan, { defaultPlan: "PER_TRANSACTION" });
    }
    const targetPlan = "PER_TRANSACTION";

    await merchantFeeRepository.recordAudit(client, {
      eventType: "MERCHANT_FEE_PLAN_INITIALIZED",
      payload: {
        merchant_user_id: merchantUserId,
        fee_plan: targetPlan,
      },
    });

    return {
      merchant_user_id: merchantUserId,
      fee_plan: targetPlan,
    };
  },

  async getFeePlanStatus(merchantUserId, { nowMs = Date.now() } = {}) {
    if (!merchantUserId) {
      throw httpError(400, "Thiếu thông tin merchant");
    }

    const { systemConfig, effectiveConfig, upcomingSchedule } =
      await this.resolveEffectiveFeeConfig(merchantUserId, {
        role: "MERCHANT",
        atDate: new Date(nowMs),
        db: pool,
      });

    const merchantUser = await merchantFeeRepository.getMerchantUser(
      pool,
      merchantUserId,
    );
    assertActiveMerchantRow(merchantUser);

    const vnMeta = getVnMonthMeta(nowMs);
    const usage = await merchantFeeRepository.getMonthlyUsage(
      pool,
      merchantUserId,
      vnMeta.currentMonthKey,
    );
    const monthlyQrGross = Number(usage?.qr_gross_amount ?? 0);

    const withdrawQuota = await this.getWithdrawQuotaStatus(merchantUserId, {
      role: "MERCHANT",
      nowMs,
      db: pool,
    });

    return buildStatusResponse({
      merchantUser,
      feeConfig: effectiveConfig,
      systemConfig,
      upcomingSchedule,
      monthlyQrGross,
      withdrawQuota: {
        month_key: withdrawQuota.month_key,
        month: withdrawQuota.month,
        quota_per_month: withdrawQuota.quota_per_month,
        already_withdrawn: withdrawQuota.already_withdrawn,
        remaining_free_quota: withdrawQuota.remaining_free_quota,
        withdraw_fee_bps: withdrawQuota.withdraw_fee_bps,
        withdraw_fee_percent: withdrawQuota.withdraw_fee_percent,
      },
      nowMs,
    });
  },

  /**
   * Tính chi tiết phí nhận tiền của merchant (QR PAYMENT hoặc TRANSFER vào ví MERCHANT)
   * trong DB transaction đang giữ khoá `users` và khoá dòng `merchant_monthly_usage`.
   */
  async resolveMerchantTxFeeDetailsTx(
    client,
    { merchantUser, amount, transactionType = "PAYMENT", nowMs = Date.now() },
  ) {
    const txType = String(transactionType || "PAYMENT").trim().toUpperCase();
    const isMerchantInbound =
      merchantUser?.role === "MERCHANT" &&
      (txType === "PAYMENT" || txType === "QR_PAYMENT" || txType === "TRANSFER");

    if (!isMerchantInbound) {
      return calculatePerTransactionFeeDetails(
        amount,
        {
          rate_bps: 0,
          min_fee: 0,
          max_fee: null,
          free_threshold_amount: 0,
          tiers: [],
        },
        { alreadyMonthlyGross: 0 },
      );
    }

    const vnMeta = getVnMonthMeta(nowMs);
    const { effectiveConfig } = await this.resolveEffectiveFeeConfig(
      merchantUser.id,
      { role: "MERCHANT", atDate: new Date(nowMs), db: client },
    );

    // Khóa dòng doanh số tháng trước khi đọc qr_gross_amount để tránh race condition giữa 2 GD đồng thời
    const usage = await merchantFeeRepository.ensureAndLockMonthlyUsageTx(client, {
      userId: merchantUser.id,
      monthKey: vnMeta.currentMonthKey,
    });
    const alreadyMonthlyGross = Number(usage?.qr_gross_amount ?? 0);

    const details = calculatePerTransactionFeeDetails(amount, effectiveConfig, {
      alreadyMonthlyGross,
      role: "MERCHANT",
      feeType: FEE_TYPES.QR_FEE,
    });

    return {
      ...details,
      month_key: vnMeta.currentMonthKey,
    };
  },

  /**
   * Wrapper tương thích ngược trả về số nguyên phí merchant QR.
   */
  async resolveMerchantTxFeeTx(client, params) {
    const details = await this.resolveMerchantTxFeeDetailsTx(client, params);
    return details.fee_amount;
  },

  /**
   * Tính và khoá hạn mức rút tiền trong DB transaction (`WITHDRAW`).
   */
  async resolveWithdrawFeeDetailsTx(
    client,
    { user, amount, nowMs = Date.now() },
  ) {
    const quotaStatus = await this.getWithdrawQuotaStatus(user.id, {
      role: user.role || "USER",
      nowMs,
      db: client,
      forUpdate: true,
    });

    const details = calculateWithdrawFeeDetails(amount, quotaStatus.effectiveConfig, {
      alreadyWithdrawn: quotaStatus.already_withdrawn,
      role: user.role || "USER",
    });

    return {
      ...details,
      month_key: quotaStatus.month_key,
    };
  },

  /**
   * Ghi nhận hạn mức đã sử dụng trong tháng hiện tại (rút tiền hoặc doanh số QR) + ví phí hệ thống.
   */
  addMonthlyUsageTx: merchantFeeRepository.addMonthlyUsageTx.bind(merchantFeeRepository),
  verifySystemFeeWallet:
    merchantFeeRepository.verifySystemFeeWallet.bind(merchantFeeRepository),
  creditSystemFeeWalletAndLedgerTx:
    merchantFeeRepository.creditSystemFeeWalletAndLedgerTx.bind(merchantFeeRepository),

  /**
   * Hàm preview công khai cho Web Merchant & Flutter App trước khi xác nhận PIN/OTP.
   */
  async previewTransactionFee({
    transactionType,
    amount,
    actorUser = null,
    merchantUserId = null,
    role = null,
    nowMs = Date.now(),
  }) {
    const txType = String(transactionType || "").trim().toUpperCase();
    const vnMeta = getVnMonthMeta(nowMs);
    const subjectId =
      txType === "PAYMENT" || txType === "QR_PAYMENT"
        ? merchantUserId || (actorUser?.role === "MERCHANT" ? actorUser.id : null)
        : actorUser?.id || merchantUserId || null;

    let resolvedSubjectRole = role;
    if (!resolvedSubjectRole && (txType === "PAYMENT" || txType === "QR_PAYMENT") && subjectId) {
      const subjectUser = await merchantFeeRepository.getMerchantUser(pool, subjectId);
      if (subjectUser?.role) {
        resolvedSubjectRole = subjectUser.role;
      }
    }

    const targetRole = String(
      resolvedSubjectRole ||
      (txType === "PAYMENT" || txType === "QR_PAYMENT"
        ? "MERCHANT"
        : actorUser?.role || "USER"),
    ).toUpperCase();

    const { effectiveConfig } = await this.resolveEffectiveFeeConfig(subjectId, {
      role: targetRole,
      atDate: new Date(nowMs),
      db: pool,
    });

    let alreadyWithdrawn = 0;
    let alreadyMonthlyGross = 0;
    let destinationRole = null;
    let recipientEffectiveConfig = null;
    let recipientMonthlyGross = 0;

    if ((txType === "PAYMENT" || txType === "QR_PAYMENT") && subjectId) {
      const usage = await merchantFeeRepository.getMonthlyUsage(
        pool,
        subjectId,
        vnMeta.currentMonthKey,
      );
      alreadyMonthlyGross = Number(usage?.qr_gross_amount ?? 0);
    }

    if ((txType === "TRANSFER" || txType === "P2P") && merchantUserId) {
      const recipientUser = await merchantFeeRepository.getMerchantUser(
        pool,
        merchantUserId,
      );
      if (recipientUser?.role === "MERCHANT") {
        destinationRole = "MERCHANT";
        const resolvedRecipient = await this.resolveEffectiveFeeConfig(
          recipientUser.id,
          { role: "MERCHANT", atDate: new Date(nowMs), db: pool },
        );
        recipientEffectiveConfig = resolvedRecipient.effectiveConfig;
        const recipientUsage = await merchantFeeRepository.getMonthlyUsage(
          pool,
          recipientUser.id,
          vnMeta.currentMonthKey,
        );
        recipientMonthlyGross = Number(recipientUsage?.qr_gross_amount ?? 0);
      }
    }

    if (txType === "WITHDRAW" && subjectId) {
      const quotaStatus = await this.getWithdrawQuotaStatus(subjectId, {
        role: targetRole,
        nowMs,
        db: pool,
      });
      alreadyWithdrawn = quotaStatus.already_withdrawn;
    }

    const preview = previewFeeCalculation({
      transactionType: txType,
      role: targetRole,
      amount,
      effectiveConfig,
      alreadyWithdrawn,
      alreadyMonthlyGross,
      destinationRole,
      recipientEffectiveConfig,
      recipientMonthlyGross,
    });

    return {
      ...preview,
      month_key: vnMeta.currentMonthKey,
    };
  },
};

module.exports = merchantFeeService;
