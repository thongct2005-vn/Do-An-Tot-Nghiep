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
} = require("../../../../modules/fee/feeCalculator");

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
    throw httpError(400, "Vui lòng chọn loại thu phí (PER_TRANSACTION)");
  }
  if (typeof rawPlan !== "string") {
    throw httpError(
      400,
      "Loại thu phí không hợp lệ. Hệ thống hiện chỉ áp dụng PER_TRANSACTION",
    );
  }
  const normalized = rawPlan.trim().toUpperCase();
  if (normalized === "MONTHLY") {
    throw httpError(
      400,
      "Gói thu phí theo tháng đã ngừng áp dụng. Hệ thống hiện chỉ dùng biểu phí theo từng giao dịch (PER_TRANSACTION)",
    );
  }
  if (!FEE_PLANS.includes(normalized)) {
    throw httpError(
      400,
      "Loại thu phí không hợp lệ. Hệ thống hiện chỉ áp dụng PER_TRANSACTION",
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

/**
 * Thu lại phí gói tháng đang quá hạn (`PAST_DUE`), hoặc hạ về PER_TRANSACTION nếu đã hết grace_until.
 * An toàn khi gọi trong DB transaction đang khoá user & merchant_fee_settings.
 */
async function processPastDueSettingTx(
  client,
  { merchantUser, setting, feeConfig, nowMs = Date.now(), triggerTransactionId = null },
) {
  const overdueAmount = Number(setting?.overdue_amount ?? 0);
  const isPastDue = setting?.monthly_status === MONTHLY_STATUS.PAST_DUE;
  if (!setting || (!isPastDue && overdueAmount <= 0)) {
    return { setting, action: null, recovered: false };
  }

  const graceUntilMs = setting.grace_until
    ? new Date(setting.grace_until).getTime()
    : null;
  const graceExpired =
    graceUntilMs !== null && !Number.isNaN(graceUntilMs) && graceUntilMs <= nowMs;
  const effectiveOverdueAmount =
    overdueAmount > 0 ? overdueAmount : Number(feeConfig.monthly_plan_fee ?? 0);
  const overdueMonthKey = setting.overdue_month_key || getVnMonthMeta(nowMs).currentMonthKey;

  if (
    effectiveOverdueAmount > 0 &&
    Number(merchantUser.balance) >= effectiveOverdueAmount
  ) {
    const [yr, mo] = overdueMonthKey.split("-");
    const monthLabel = yr && mo ? `${mo}/${yr}` : overdueMonthKey;
    const chargeRes = await merchantFeeRepository.chargeMonthlyFeeTx(client, {
      merchantUser,
      amount: effectiveOverdueAmount,
      monthLabel,
      monthKey: overdueMonthKey,
      idempotencyKey: `MERCHANT_FEE:${merchantUser.id}:${overdueMonthKey}`,
      rateSnapshot: {
        fee_type: FEE_TYPES.MONTHLY_PLAN_FEE,
        ...(feeConfig.schedule_id ? { schedule_id: feeConfig.schedule_id } : {}),
        month_key: overdueMonthKey,
        monthly_plan_fee: effectiveOverdueAmount,
        recovered_from_past_due: true,
        downgraded_after_grace: !isPastDue || graceExpired,
      },
    });

    if (chargeRes.charged) {
      if (chargeRes.balanceAfter !== undefined) {
        merchantUser.balance = chargeRes.balanceAfter;
      }
      const recoveredSetting = await merchantFeeRepository.upsertFeeSetting(client, {
        merchantUserId: merchantUser.id,
        feePlan: "PER_TRANSACTION",
        pendingFeePlan: null,
        expiresAt: null,
        monthlyPlanEnabled: false,
        monthlyStatus: MONTHLY_STATUS.INACTIVE,
        graceUntil: null,
        overdueMonthKey: null,
        overdueAmount: 0,
      });

      await merchantFeeRepository.recordAudit(client, {
        eventType: "MERCHANT_MONTHLY_FEE_RECOVERED",
        payload: {
          merchant_user_id: merchantUser.id,
          month_key: overdueMonthKey,
          amount: effectiveOverdueAmount,
          transaction_id: chargeRes.transactionId || null,
          trigger_transaction_id: triggerTransactionId || null,
          kept_fee_plan: "PER_TRANSACTION",
        },
      });

      console.info(
        `[fee] Recovered overdue fee merchant=${merchantUser.id} month=${overdueMonthKey} amount=${effectiveOverdueAmount}`,
      );
      return { setting: recoveredSetting, action: "RECOVERED", recovered: true };
    }
  }

  if (isPastDue && graceExpired) {
    // Hạ về PER_TRANSACTION khi hết thời gian ân hạn nhưng GIỮ nguyên overdue_amount & overdue_month_key để thu bù khi có tiền vào
    const downgraded = await merchantFeeRepository.upsertFeeSetting(client, {
      merchantUserId: merchantUser.id,
      feePlan: "PER_TRANSACTION",
      pendingFeePlan: null,
      expiresAt: null,
      monthlyPlanEnabled: false,
      monthlyStatus: MONTHLY_STATUS.INACTIVE,
      graceUntil: null,
      overdueMonthKey,
      overdueAmount: effectiveOverdueAmount,
    });

    await merchantFeeRepository.recordAudit(client, {
      eventType: "MERCHANT_MONTHLY_FEE_GRACE_EXPIRED",
      payload: {
        merchant_user_id: merchantUser.id,
        overdue_month_key: overdueMonthKey,
        overdue_amount: effectiveOverdueAmount,
        downgraded_to: "PER_TRANSACTION",
        debt_preserved: effectiveOverdueAmount > 0,
      },
    });

    console.info(
      `[fee] Grace period expired, downgraded merchant=${merchantUser.id} to PER_TRANSACTION overdue_month=${overdueMonthKey} kept_debt=${effectiveOverdueAmount}`,
    );
    return { setting: downgraded, action: "DOWNGRADED_EXPIRED_GRACE", recovered: false };
  }

  return { setting, action: isPastDue ? "STILL_PAST_DUE" : "DEBT_PENDING", recovered: false };
}

/**
 * Chuẩn hóa / chuyển kỳ về PER_TRANSACTION (tắt gia hạn/thu 300k/tháng) và xử lý nợ cũ PAST_DUE nếu có.
 * Đảm bảo đúng thứ tự khoá: `users` trước -> `merchant_fee_settings` sau -> `SYSTEM_FEE_WALLET` cuối.
 */
async function applyDueRolloverTx(
  client,
  { merchantUser, setting, feeConfig, nowMs = Date.now() },
) {
  if (!setting) {
    return setting;
  }

  // 1. Nếu còn trạng thái PAST_DUE hoặc còn nợ overdue_amount: xử lý thu bù hoặc hạ cấp giữ nợ
  if (
    setting.monthly_status === MONTHLY_STATUS.PAST_DUE ||
    Number(setting.overdue_amount || 0) > 0
  ) {
    const pastDueRes = await processPastDueSettingTx(client, {
      merchantUser,
      setting,
      feeConfig,
      nowMs,
    });
    setting = pastDueRes.setting;
    if (setting.monthly_status === MONTHLY_STATUS.PAST_DUE) {
      return setting;
    }
  }

  // 2. Ngừng thu phí gói tháng 300k/tháng: mọi bản ghi còn MONTHLY / pending_fee_plan / expires_at được đưa về PER_TRANSACTION
  const needsNormalizationToPerTx =
    setting.fee_plan === "MONTHLY" ||
    Boolean(setting.pending_fee_plan) ||
    Boolean(setting.monthly_plan_enabled) ||
    Boolean(setting.expires_at);

  if (!needsNormalizationToPerTx) {
    return setting;
  }

  const vnMeta = getVnMonthMeta(nowMs);
  const updated = await merchantFeeRepository.upsertFeeSetting(client, {
    merchantUserId: merchantUser.id,
    feePlan: "PER_TRANSACTION",
    pendingFeePlan: null,
    expiresAt: null,
    monthlyPlanEnabled: false,
    monthlyStatus: MONTHLY_STATUS.INACTIVE,
    graceUntil: null,
    overdueMonthKey: setting.overdue_month_key || null,
    overdueAmount: Number(setting.overdue_amount || 0),
  });

  await merchantFeeRepository.recordAudit(client, {
    eventType: "MERCHANT_FEE_PLAN_ROLLED_OVER",
    payload: {
      merchant_user_id: merchantUser.id,
      from_plan: setting.fee_plan,
      to_plan: "PER_TRANSACTION",
      month: vnMeta.currentMonthKey,
    },
  });

  return updated;
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
   * Giải mã cấu hình hiệu lực tại thời điểm `atDate` cho user hoặc merchant (system default + schedule override).
   */
  async resolveEffectiveFeeConfig(
    userId,
    { role = "MERCHANT", atDate = new Date(), db = pool } = {},
  ) {
    const normalizedRole = String(role || "MERCHANT").toUpperCase();
    const systemConfig = await this.getSystemFeeConfig(normalizedRole, db);

    if (!userId || normalizedRole !== "MERCHANT") {
      return {
        systemConfig,
        effectiveConfig: mergeEffectiveFeeConfig(systemConfig, null, normalizedRole),
        effectiveSchedule: null,
        upcomingSchedule: null,
      };
    }

    const schedules = await merchantFeeRepository.getSchedulesForMerchant(db, userId);
    const { effectiveSchedule, upcomingSchedule } = pickEffectiveSchedule(
      schedules,
      atDate,
    );
    const effectiveConfig = mergeEffectiveFeeConfig(
      systemConfig,
      effectiveSchedule,
      normalizedRole,
    );

    return {
      systemConfig,
      effectiveConfig,
      effectiveSchedule,
      upcomingSchedule,
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
    { merchantUserId, feePlan, nowMs = Date.now() },
  ) {
    // Đăng ký mới luôn áp dụng biểu phí PER_TRANSACTION (gói tháng đã ngừng áp dụng)
    if (feePlan !== undefined && feePlan !== null && String(feePlan).trim() !== "") {
      normalizeRequestedPlan(feePlan, { defaultPlan: "PER_TRANSACTION" });
    }
    const targetPlan = "PER_TRANSACTION";

    const setting = await merchantFeeRepository.upsertFeeSetting(client, {
      merchantUserId,
      feePlan: targetPlan,
      pendingFeePlan: null,
      expiresAt: null,
      monthlyPlanEnabled: false,
      monthlyStatus: MONTHLY_STATUS.INACTIVE,
      graceUntil: null,
      overdueMonthKey: null,
      overdueAmount: 0,
    });

    await merchantFeeRepository.recordAudit(client, {
      eventType: "MERCHANT_FEE_PLAN_INITIALIZED",
      payload: {
        merchant_user_id: merchantUserId,
        fee_plan: targetPlan,
        monthly_plan_enabled: false,
        expires_at: null,
      },
    });

    return setting;
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

    let merchantUser = await merchantFeeRepository.getMerchantUser(
      pool,
      merchantUserId,
    );
    assertActiveMerchantRow(merchantUser);

    let setting = await merchantFeeRepository.getFeeSetting(pool, merchantUserId);

    const needsRollover = Boolean(
      setting &&
        (setting.fee_plan === "MONTHLY" ||
          setting.pending_fee_plan ||
          setting.monthly_plan_enabled ||
          (setting.expires_at && new Date(setting.expires_at).getTime() <= nowMs) ||
          setting.monthly_status === MONTHLY_STATUS.PAST_DUE ||
          Number(setting.overdue_amount || 0) > 0),
    );

    if (needsRollover) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        merchantUser = await merchantFeeRepository.getMerchantUser(
          client,
          merchantUserId,
          { forUpdate: true },
        );
        assertActiveMerchantRow(merchantUser);
        setting = await merchantFeeRepository.getFeeSetting(
          client,
          merchantUserId,
          { forUpdate: true },
        );
        setting = await applyDueRolloverTx(client, {
          merchantUser,
          setting,
          feeConfig: effectiveConfig,
          nowMs,
        });
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

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
      setting,
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
    { feePlan: rawFeePlan, nowMs = Date.now() },
  ) {
    if (!merchantUserId) {
      throw httpError(400, "Thiếu thông tin merchant");
    }

    const targetPlan = normalizeRequestedPlan(rawFeePlan);
    const { systemConfig, effectiveConfig, upcomingSchedule } =
      await this.resolveEffectiveFeeConfig(merchantUserId, {
        role: "MERCHANT",
        atDate: new Date(nowMs),
        db: pool,
      });
    const vnMeta = getVnMonthMeta(nowMs);

    const client = await pool.connect();
    let finalSetting;
    let merchantUser;
    let action;

    try {
      await client.query("BEGIN");

      merchantUser = await merchantFeeRepository.getMerchantUser(
        client,
        merchantUserId,
        { forUpdate: true },
      );
      assertActiveMerchantRow(merchantUser);

      let setting = await merchantFeeRepository.getFeeSetting(
        client,
        merchantUserId,
        { forUpdate: true },
      );
      setting = await applyDueRolloverTx(client, {
        merchantUser,
        setting,
        feeConfig: effectiveConfig,
        nowMs,
      });

      const currentPlan = setting?.fee_plan || "PER_TRANSACTION";
      const pendingPlan = setting?.pending_fee_plan || null;
      const existingExpiresAt = setting?.expires_at
        ? new Date(setting.expires_at)
        : null;

      if (targetPlan === currentPlan && !pendingPlan) {
        throw httpError(
          400,
          `Bạn đang áp dụng gói ${PLAN_NAMES[currentPlan]} rồi`,
        );
      }

      if (pendingPlan === targetPlan) {
        throw httpError(
          400,
          `Gói ${PLAN_NAMES[targetPlan]} đã được lên lịch áp dụng từ tháng sau (${vnMeta.nextMonthStartDate}) rồi`,
        );
      }

      if (pendingPlan && targetPlan === currentPlan) {
        finalSetting = await merchantFeeRepository.upsertFeeSetting(client, {
          merchantUserId,
          feePlan: currentPlan,
          pendingFeePlan: null,
          expiresAt: currentPlan === "MONTHLY" ? existingExpiresAt : null,
          monthlyPlanEnabled: currentPlan === "MONTHLY",
          monthlyStatus:
            setting?.monthly_status === MONTHLY_STATUS.PAST_DUE
              ? MONTHLY_STATUS.PAST_DUE
              : currentPlan === "MONTHLY"
                ? MONTHLY_STATUS.ACTIVE
                : MONTHLY_STATUS.INACTIVE,
          graceUntil: setting?.grace_until || null,
          overdueMonthKey: setting?.overdue_month_key || null,
          overdueAmount: setting?.overdue_amount || 0,
        });
        action = "CANCELLED_PENDING_CHANGE";
        await merchantFeeRepository.recordAudit(client, {
          eventType: "MERCHANT_FEE_PLAN_CHANGE_CANCELLED",
          payload: {
            merchant_user_id: merchantUserId,
            current_plan: currentPlan,
            cancelled_pending_plan: pendingPlan,
          },
        });
      } else {
        const nextExpiresAt =
          currentPlan === "MONTHLY" &&
          existingExpiresAt &&
          existingExpiresAt.getTime() > nowMs
            ? existingExpiresAt
            : vnMeta.nextMonthStart;

        const nextMonthlyStatus =
          setting?.monthly_status === MONTHLY_STATUS.PAST_DUE
            ? MONTHLY_STATUS.PAST_DUE
            : currentPlan === "MONTHLY"
              ? MONTHLY_STATUS.ACTIVE
              : MONTHLY_STATUS.PENDING_ACTIVATE;

        finalSetting = await merchantFeeRepository.upsertFeeSetting(client, {
          merchantUserId,
          feePlan: currentPlan,
          pendingFeePlan: targetPlan,
          expiresAt: nextExpiresAt,
          monthlyPlanEnabled: currentPlan === "MONTHLY",
          monthlyStatus: nextMonthlyStatus,
          graceUntil: setting?.grace_until || null,
          overdueMonthKey: setting?.overdue_month_key || null,
          overdueAmount: setting?.overdue_amount || 0,
        });
        action = "SCHEDULED_NEXT_MONTH";
        await merchantFeeRepository.recordAudit(client, {
          eventType: "MERCHANT_FEE_PLAN_SCHEDULED",
          payload: {
            merchant_user_id: merchantUserId,
            current_plan: currentPlan,
            pending_plan: targetPlan,
            effective_from: nextExpiresAt.toISOString(),
          },
        });
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const withdrawQuota = await this.getWithdrawQuotaStatus(merchantUserId, {
      role: "MERCHANT",
      nowMs,
      db: pool,
    });

    return buildStatusResponse({
      setting: finalSetting,
      merchantUser,
      feeConfig: effectiveConfig,
      systemConfig,
      upcomingSchedule,
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
      action,
    });
  },

  async cancelPendingFeePlan(merchantUserId, { nowMs = Date.now() } = {}) {
    if (!merchantUserId) {
      throw httpError(400, "Thiếu thông tin merchant");
    }

    const { systemConfig, effectiveConfig, upcomingSchedule } =
      await this.resolveEffectiveFeeConfig(merchantUserId, {
        role: "MERCHANT",
        atDate: new Date(nowMs),
        db: pool,
      });
    const client = await pool.connect();
    let finalSetting;
    let merchantUser;

    try {
      await client.query("BEGIN");

      merchantUser = await merchantFeeRepository.getMerchantUser(
        client,
        merchantUserId,
        { forUpdate: true },
      );
      assertActiveMerchantRow(merchantUser);

      let setting = await merchantFeeRepository.getFeeSetting(
        client,
        merchantUserId,
        { forUpdate: true },
      );
      setting = await applyDueRolloverTx(client, {
        merchantUser,
        setting,
        feeConfig: effectiveConfig,
        nowMs,
      });

      const currentPlan = setting?.fee_plan || "PER_TRANSACTION";
      const pendingPlan = setting?.pending_fee_plan || null;

      if (!pendingPlan || pendingPlan === currentPlan) {
        throw httpError(400, "Hiện không có lịch đổi gói thu phí nào để hủy");
      }

      finalSetting = await merchantFeeRepository.upsertFeeSetting(client, {
        merchantUserId,
        feePlan: currentPlan,
        pendingFeePlan: null,
        expiresAt: currentPlan === "MONTHLY" ? setting.expires_at : null,
        monthlyPlanEnabled: currentPlan === "MONTHLY",
        monthlyStatus:
          setting?.monthly_status === MONTHLY_STATUS.PAST_DUE
            ? MONTHLY_STATUS.PAST_DUE
            : currentPlan === "MONTHLY"
              ? MONTHLY_STATUS.ACTIVE
              : MONTHLY_STATUS.INACTIVE,
        graceUntil: setting?.grace_until || null,
        overdueMonthKey: setting?.overdue_month_key || null,
        overdueAmount: setting?.overdue_amount || 0,
      });

      await merchantFeeRepository.recordAudit(client, {
        eventType: "MERCHANT_FEE_PLAN_CHANGE_CANCELLED",
        payload: {
          merchant_user_id: merchantUserId,
          current_plan: currentPlan,
          cancelled_pending_plan: pendingPlan,
        },
      });

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const withdrawQuota = await this.getWithdrawQuotaStatus(merchantUserId, {
      role: "MERCHANT",
      nowMs,
      db: pool,
    });

    return buildStatusResponse({
      setting: finalSetting,
      merchantUser,
      feeConfig: effectiveConfig,
      systemConfig,
      upcomingSchedule,
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
      action: "CANCELLED_PENDING_CHANGE",
    });
  },

  async processDueRollovers(limit = 100, { nowMs = Date.now() } = {}) {
    const dueIds = await merchantFeeRepository.getDueRolloverMerchantIds(
      pool,
      limit,
    );
    if (!dueIds.length) return 0;

    let processed = 0;

    for (const merchantUserId of dueIds) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const merchantUser = await merchantFeeRepository.getMerchantUser(
          client,
          merchantUserId,
          { forUpdate: true },
        );
        if (!merchantUser || merchantUser.role !== "MERCHANT") {
          await client.query("ROLLBACK");
          continue;
        }
        const { effectiveConfig } = await this.resolveEffectiveFeeConfig(
          merchantUserId,
          { role: "MERCHANT", atDate: new Date(nowMs), db: client },
        );
        const setting = await merchantFeeRepository.getFeeSetting(
          client,
          merchantUserId,
          { forUpdate: true },
        );
        await applyDueRolloverTx(client, {
          merchantUser,
          setting,
          feeConfig: effectiveConfig,
          nowMs,
        });
        await client.query("COMMIT");
        processed++;
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(
          `[merchantFeeRollover] Lỗi chuyển kỳ cho merchant ${merchantUserId}:`,
          e.message,
        );
      } finally {
        client.release();
      }
    }

    return processed;
  },

  /**
   * Thu lại nợ phí tháng (`PAST_DUE` hoặc nợ còn lại sau khi hết ân hạn) ngay khi ví merchant vừa nhận được tiền vào.
   */
  async collectOverdueMonthlyFeeOnCreditTx(
    client,
    { merchantUser, triggerTransactionId = null, nowMs = Date.now() },
  ) {
    if (!merchantUser || merchantUser.role !== "MERCHANT") {
      return { recovered: false };
    }
    const setting = await merchantFeeRepository.getFeeSetting(
      client,
      merchantUser.id,
      { forUpdate: true },
    );
    if (
      !setting ||
      (setting.monthly_status !== MONTHLY_STATUS.PAST_DUE &&
        Number(setting.overdue_amount || 0) <= 0)
    ) {
      return { recovered: false };
    }

    const { effectiveConfig } = await this.resolveEffectiveFeeConfig(
      merchantUser.id,
      { role: "MERCHANT", atDate: new Date(nowMs), db: client },
    );

    return processPastDueSettingTx(client, {
      merchantUser,
      setting,
      feeConfig: effectiveConfig,
      nowMs,
      triggerTransactionId,
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
        { rate_bps: 0, min_fee: 0, max_fee: null, tiers: [] },
        { monthlyPlanActive: false, alreadyMonthlyGross: 0 },
      );
    }

    const vnMeta = getVnMonthMeta(nowMs);
    const { effectiveConfig } = await this.resolveEffectiveFeeConfig(
      merchantUser.id,
      { role: "MERCHANT", atDate: new Date(nowMs), db: client },
    );

    const setting = await merchantFeeRepository.getFeeSetting(
      client,
      merchantUser.id,
      { forUpdate: true },
    );

    // Đưa bản ghi cũ (nếu còn MONTHLY / pending) về PER_TRANSACTION mà không trừ 300k/tháng
    if (
      setting &&
      (setting.fee_plan === "MONTHLY" ||
        setting.pending_fee_plan ||
        setting.monthly_plan_enabled ||
        (setting.expires_at && new Date(setting.expires_at).getTime() <= nowMs))
    ) {
      await applyDueRolloverTx(client, {
        merchantUser,
        setting,
        feeConfig: effectiveConfig,
        nowMs,
      });
    }

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
