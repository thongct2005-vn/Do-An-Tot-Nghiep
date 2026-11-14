const pool = require("../../../../config/database");
const { httpError } = require("../../../../utils/httpError");
const { formatVnd } = require("../../../../utils/amount");
const { getSystemConfig } = require("../../../../utils/limitsDb");
const merchantFeeRepository = require("./fee.repository");
const {
  VN_OFFSET_MS,
  FEE_TYPES,
  MONTHLY_STATUS,
  normalizeSystemFeeConfig,
  mergeEffectiveFeeConfig,
  pickEffectiveSchedule,
  calculatePerTransactionFeeDetails,
  calculateWithdrawFeeDetails,
  previewFeeCalculation,
  getVnMonthMeta,
} = require("../../../fee/feeCalculator");

const FEE_PLANS = ["PER_TRANSACTION"];

const PLAN_NAMES = {
  PER_TRANSACTION: "Thu phí theo từng giao dịch (lũy tiến)",
  MONTHLY: "Trả phí theo tháng (ngừng áp dụng)",
};

function formatVnDateOnly(dateInput) {
  if (!dateInput) return null;
  const dt = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(dt.getTime())) return null;
  const vn = new Date(dt.getTime() + VN_OFFSET_MS);
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = vn.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function assertActiveMerchantRow(user) {
  if (!user || user.role !== "MERCHANT" || user.status !== "ACTIVE") {
    throw httpError(
      403,
      "Tài khoản merchant đang bị khoá hoặc không khả dụng",
    );
  }
}

function normalizeRequestedPlan(rawPlan, { defaultPlan = null } = {}) {
  if (
    rawPlan === undefined ||
    rawPlan === null ||
    (typeof rawPlan === "string" && !rawPlan.trim())
  ) {
    if (defaultPlan) return defaultPlan;
    throw httpError(400, "Vui lòng chọn hình thức thu phí theo từng giao dịch");
  }
  if (typeof rawPlan !== "string") {
    throw httpError(
      400,
      "Hình thức thu phí không hợp lệ, hệ thống hiện chỉ áp dụng thu phí theo từng giao dịch",
    );
  }
  const normalized = rawPlan.trim().toUpperCase();
  if (normalized === "MONTHLY") {
    throw httpError(
      400,
      "Gói thu phí theo tháng đã ngừng áp dụng, hệ thống hiện chỉ dùng biểu phí theo từng giao dịch",
    );
  }
  if (!FEE_PLANS.includes(normalized)) {
    throw httpError(
      400,
      "Hình thức thu phí không hợp lệ, hệ thống hiện chỉ áp dụng thu phí theo từng giao dịch",
    );
  }
  return normalized;
}

function buildFormattedTiers(feeConfig) {
  const rawTiers = Array.isArray(feeConfig?.tiers) ? feeConfig.tiers : [];
  if (!rawTiers.length) return [];
  const sorted = [...rawTiers].sort(
    (a, b) => Number(a.from_amount || 0) - Number(b.from_amount || 0),
  );
  return sorted.map((t, idx) => {
    const fromAmount = Number(t.from_amount || 0);
    const toAmount =
      idx + 1 < sorted.length ? Number(sorted[idx + 1].from_amount) : null;
    const rateBps = Number(t.rate_bps || 0);
    const ratePercent = Number((rateBps / 100).toFixed(2));
    const rangeLabel =
      toAmount !== null
        ? fromAmount === 0
          ? `Đến dưới ${formatVnd(toAmount)}`
          : `Từ ${formatVnd(fromAmount)} đến dưới ${formatVnd(toAmount)}`
        : `Từ ${formatVnd(fromAmount)} trở lên`;
    return {
      from_amount: fromAmount,
      to_amount: toAmount,
      rate_bps: rateBps,
      rate_percent: ratePercent,
      label: rangeLabel,
    };
  });
}

function formatPlanList(feeConfig, currentPlan, pendingPlan) {
  const perTx = feeConfig.PER_TRANSACTION;
  const formattedTiers = buildFormattedTiers(feeConfig);
  const percent = Number((perTx.percent_bps / 100).toFixed(2));
  const maxText =
    perTx.max_fee != null
      ? `, tối đa ${formatVnd(perTx.max_fee)}`
      : ", không giới hạn tối đa";
  const thresholdText =
    feeConfig.free_threshold_amount > 0
      ? `, miễn phí GD < ${formatVnd(feeConfig.free_threshold_amount)}`
      : "";

  const tierText =
    formattedTiers.length > 1
      ? `Lũy tiến theo doanh số QR tháng (${formattedTiers
        .map((t) => `${t.rate_percent}%`)
        .join(" → ")})`
      : `${percent}% / giao dịch`;

  return [
    {
      code: "PER_TRANSACTION",
      name: PLAN_NAMES.PER_TRANSACTION,
      percent_bps: perTx.percent_bps,
      rate_bps: perTx.percent_bps,
      percent,
      min_fee: perTx.min_fee,
      max_fee: perTx.max_fee,
      free_threshold_amount: feeConfig.free_threshold_amount,
      transfer_fee_bps: feeConfig.transfer_fee_bps ?? 0,
      transfer_fee_percent: feeConfig.transfer_fee_percent ?? 0,
      transfer_min_fee: feeConfig.transfer_min_fee ?? 0,
      transfer_max_fee: feeConfig.transfer_max_fee ?? null,
      tiers: formattedTiers,
      summary: `${tierText} (tối thiểu ${formatVnd(perTx.min_fee)}${maxText}${thresholdText})`,
      is_current: (currentPlan || "PER_TRANSACTION") === "PER_TRANSACTION",
      is_pending: pendingPlan === "PER_TRANSACTION",
    },
  ];
}

function formatScheduleSummary(scheduleRow, systemConfig) {
  if (!scheduleRow) return null;
  const merged = mergeEffectiveFeeConfig(systemConfig, scheduleRow, "MERCHANT");
  return {
    id: scheduleRow.id,
    effective_from: new Date(scheduleRow.effective_from).toISOString(),
    effective_from_date: formatVnDateOnly(scheduleRow.effective_from),
    rate_bps: merged.rate_bps,
    rate_percent: merged.rate_percent,
    min_fee: merged.min_fee,
    max_fee: merged.max_fee,
    free_threshold_amount: merged.free_threshold_amount,
    transfer_fee_bps: merged.transfer_fee_bps,
    transfer_fee_percent: merged.transfer_fee_percent,
    transfer_min_fee: merged.transfer_min_fee,
    transfer_max_fee: merged.transfer_max_fee,
    withdraw_fee_bps: merged.withdraw_fee_bps,
    withdraw_fee_percent: merged.withdraw_fee_percent,
    withdraw_free_quota_per_month: merged.withdraw_free_quota_per_month,
    monthly_plan_enabled: merged.monthly_plan_enabled,
    monthly_plan_fee: merged.monthly_plan_fee,
    tiers: merged.tiers || [],
    reason: scheduleRow.reason || null,
  };
}

function buildStatusResponse({
  setting,
  merchantUser,
  feeConfig,
  systemConfig = null,
  upcomingSchedule = null,
  withdrawQuota = null,
  monthlyQrGross = 0,
  nowMs = Date.now(),
  action = null,
}) {
  const vnMeta = getVnMonthMeta(nowMs);
  const currentPlan = setting?.fee_plan || "PER_TRANSACTION";
  const pendingPlan = setting?.pending_fee_plan || null;
  const hasPendingChange = Boolean(pendingPlan && pendingPlan !== currentPlan);

  const expiresAtDateObj = setting?.expires_at ? new Date(setting.expires_at) : null;
  const effectiveFrom = hasPendingChange
    ? (expiresAtDateObj || vnMeta.nextMonthStart).toISOString()
    : null;
  const effectiveFromDate = hasPendingChange
    ? formatVnDateOnly(effectiveFrom)
    : null;

  const monthlyStatus =
    setting?.monthly_status ||
    (currentPlan === "MONTHLY"
      ? MONTHLY_STATUS.ACTIVE
      : hasPendingChange && pendingPlan === "MONTHLY"
        ? MONTHLY_STATUS.PENDING_ACTIVATE
        : MONTHLY_STATUS.INACTIVE);

  const currentLabel =
    monthlyStatus === MONTHLY_STATUS.PAST_DUE
      ? `Đang áp dụng: ${PLAN_NAMES[currentPlan]} (Quá hạn thanh toán phí tháng)`
      : `Đang áp dụng: ${PLAN_NAMES[currentPlan]}`;
  const nextMonthLabel = hasPendingChange
    ? `Áp dụng từ tháng sau (${effectiveFromDate}): ${PLAN_NAMES[pendingPlan]}`
    : null;

  const walletBalance = Number(merchantUser?.balance ?? 0);
  const monthlyFee = feeConfig.monthly_plan_fee;
  const sufficientBalanceForNextPlan =
    pendingPlan === "MONTHLY" ? walletBalance >= monthlyFee : true;

  const graceUntilIso = setting?.grace_until
    ? new Date(setting.grace_until).toISOString()
    : null;

  const payload = {
    current_plan: currentPlan,
    current_plan_name: PLAN_NAMES[currentPlan],
    pending_plan: hasPendingChange ? pendingPlan : null,
    pending_plan_name: hasPendingChange ? PLAN_NAMES[pendingPlan] : null,
    has_pending_change: hasPendingChange,
    monthly_plan_enabled: Boolean(
      setting?.monthly_plan_enabled ?? (currentPlan === "MONTHLY"),
    ),
    monthly_status: monthlyStatus,
    grace_until: graceUntilIso,
    grace_until_date: formatVnDateOnly(graceUntilIso),
    overdue_month_key: setting?.overdue_month_key || null,
    overdue_amount: Number(setting?.overdue_amount ?? 0),
    current_month: vnMeta.currentMonth,
    current_month_end_date: vnMeta.currentMonthEndDate,
    next_month: vnMeta.nextMonth,
    effective_from: effectiveFrom,
    effective_from_date: effectiveFromDate,
    expires_at: expiresAtDateObj ? expiresAtDateObj.toISOString() : null,
    expires_at_date: formatVnDateOnly(expiresAtDateObj),
    display: {
      current_label: currentLabel,
      next_month_label: nextMonthLabel,
    },
    wallet_balance: walletBalance,
    sufficient_balance_for_next_plan: sufficientBalanceForNextPlan,
    effective_fee_config: {
      source: feeConfig.source || "SYSTEM_DEFAULT",
      schedule_id: feeConfig.schedule_id || null,
      effective_from: feeConfig.effective_from || null,
      rate_bps: feeConfig.rate_bps,
      rate_percent: feeConfig.rate_percent,
      min_fee: feeConfig.min_fee,
      max_fee: feeConfig.max_fee,
      max_fee_unbounded: feeConfig.max_fee === null,
      free_threshold_amount: feeConfig.free_threshold_amount,
      transfer_fee_bps: feeConfig.transfer_fee_bps ?? 0,
      transfer_fee_percent: feeConfig.transfer_fee_percent ?? 0,
      transfer_min_fee: feeConfig.transfer_min_fee ?? 0,
      transfer_max_fee: feeConfig.transfer_max_fee ?? null,
      transfer_max_fee_unbounded: (feeConfig.transfer_max_fee ?? null) === null,
      withdraw_fee_bps: feeConfig.withdraw_fee_bps,
      withdraw_fee_percent: feeConfig.withdraw_fee_percent,
      withdraw_free_quota_per_month: feeConfig.withdraw_free_quota_per_month,
      monthly_plan_enabled: false,
      monthly_plan_fee: feeConfig.monthly_plan_fee,
      monthly_grace_days: feeConfig.monthly_grace_days,
      tiers: buildFormattedTiers(feeConfig),
    },
    monthly_qr_gross_amount: Number(monthlyQrGross || 0),
    upcoming_fee_schedule: upcomingSchedule
      ? formatScheduleSummary(upcomingSchedule, systemConfig || feeConfig)
      : null,
    withdraw_quota: withdrawQuota,
    available_plans: formatPlanList(
      feeConfig,
      currentPlan,
      hasPendingChange ? pendingPlan : null,
    ),
  };

  if (action) {
    payload.action = action;
  }
  return payload;
}

const merchantFeeService = {
  FEE_PLANS,
  PLAN_NAMES,
  MONTHLY_STATUS,
  FEE_TYPES,
  getVnMonthMeta,
  normalizeRequestedPlan,

  /**
   * Wrapper tương thích ngược: tính phí 1 giao dịch QR theo config đã truyền vào.
   */
  calculatePerTransactionFee(amount, feeConfig) {
    return calculatePerTransactionFeeDetails(amount, feeConfig, {
      monthlyPlanActive: false,
    }).fee_amount;
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
    // Đăng ký mới luôn áp dụng biểu phí PER_TRANSACTION (gói tháng đã ngừng áp dụng)
    if (feePlan !== undefined && feePlan !== null && String(feePlan).trim() !== "") {
      normalizeRequestedPlan(feePlan, { defaultPlan: "PER_TRANSACTION" });
    }
    const targetPlan = "PER_TRANSACTION";

    await merchantFeeRepository.recordAudit(client, {
      eventType: "MERCHANT_FEE_PLAN_INITIALIZED",
      payload: {
        merchant_user_id: merchantUserId,
        fee_plan: targetPlan,
        monthly_plan_enabled: false,
      },
    });

    return {
      merchant_user_id: merchantUserId,
      fee_plan: targetPlan,
      pending_fee_plan: null,
      expires_at: null,
      monthly_plan_enabled: false,
      monthly_status: MONTHLY_STATUS.INACTIVE,
      grace_until: null,
      overdue_month_key: null,
      overdue_amount: 0,
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
      setting: null,
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

  async selectFeePlan(
    merchantUserId,
    { feePlan: rawFeePlan } = {},
  ) {
    if (!merchantUserId) {
      throw httpError(400, "Thiếu thông tin merchant");
    }

    const targetPlan = normalizeRequestedPlan(rawFeePlan);
    const merchantUser = await merchantFeeRepository.getMerchantUser(
      pool,
      merchantUserId,
    );
    assertActiveMerchantRow(merchantUser);

    throw httpError(
      400,
      `Bạn đang áp dụng gói ${PLAN_NAMES[targetPlan]} rồi`,
    );
  },

  async cancelPendingFeePlan(merchantUserId) {
    if (!merchantUserId) {
      throw httpError(400, "Thiếu thông tin merchant");
    }

    const merchantUser = await merchantFeeRepository.getMerchantUser(
      pool,
      merchantUserId,
    );
    assertActiveMerchantRow(merchantUser);

    throw httpError(400, "Hiện không có lịch đổi gói thu phí nào để hủy");
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
        { monthlyPlanActive: false, alreadyMonthlyGross: 0 },
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
      monthlyPlanActive: false,
      monthlyStatus: MONTHLY_STATUS.INACTIVE,
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
      monthlyPlanActive: false,
      monthlyStatus: MONTHLY_STATUS.INACTIVE,
    });

    return {
      ...preview,
      month_key: vnMeta.currentMonthKey,
    };
  },
};

module.exports = merchantFeeService;
