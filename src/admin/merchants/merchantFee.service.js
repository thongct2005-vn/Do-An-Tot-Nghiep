const pool = require("../../config/database");
const { uuidv7 } = require("uuidv7");
const { httpError } = require("../../utils/httpError");
const { invalidateLimitsCache, getSystemConfig } = require("../../utils/limitsDb");
const merchantFeeService = require("../merchant/production/fee/fee.service");
const {
  SYSTEM_FEE_WALLET_ID,
  normalizeSystemFeeConfig,
  validateFeeConfigInput,
  mergeEffectiveFeeConfig,
  pickEffectiveSchedule,
  previewFeeCalculation,
  getVnMonthMeta,
} = require("../../modules/fee/feeCalculator");

const DEFAULT_SAMPLE_AMOUNTS = [10_000, 50_000, 100_000, 1_000_000, 10_000_000];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidReason(rawReason) {
  if (typeof rawReason !== "string") {
    throw httpError(400, "Vui lòng nhập lý do cập nhật cấu hình phí");
  }
  const clean = rawReason.trim();
  if (clean.length < 5 || clean.length > 500) {
    throw httpError(400, "Lý do thay đổi cấu hình phí phải từ 5 đến 500 ký tự");
  }
  return clean;
}

function normalizeRoleParam(rawRole) {
  const role = String(rawRole || "MERCHANT").trim().toUpperCase();
  if (!["MERCHANT", "USER"].includes(role)) {
    throw httpError(400, "role chỉ chấp nhận MERCHANT hoặc USER");
  }
  return role;
}

function parseSampleAmounts(rawSamples) {
  if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
    return DEFAULT_SAMPLE_AMOUNTS;
  }
  const parsed = rawSamples
    .map((n) => Number(n))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
  if (parsed.length === 0) {
    throw httpError(400, "Danh sách mức tiền mẫu không hợp lệ");
  }
  return parsed.slice(0, 20);
}

function simulateFeeSamples({
  oldConfig,
  newConfig,
  role = "MERCHANT",
  alreadyWithdrawn = 0,
  sampleAmounts = DEFAULT_SAMPLE_AMOUNTS,
}) {
  return sampleAmounts.map((amount) => {
    const oldQr = previewFeeCalculation({
      transactionType: "PAYMENT",
      role,
      amount,
      effectiveConfig: oldConfig,
      monthlyPlanActive: false,
    });
    const newQr = previewFeeCalculation({
      transactionType: "PAYMENT",
      role,
      amount,
      effectiveConfig: newConfig,
      monthlyPlanActive: false,
    });
    const oldWithdraw = previewFeeCalculation({
      transactionType: "WITHDRAW",
      role,
      amount,
      effectiveConfig: oldConfig,
      alreadyWithdrawn,
    });
    const newWithdraw = previewFeeCalculation({
      transactionType: "WITHDRAW",
      role,
      amount,
      effectiveConfig: newConfig,
      alreadyWithdrawn,
    });

    const oldTransfer = previewFeeCalculation({
      transactionType: "TRANSFER",
      role,
      amount,
      effectiveConfig: oldConfig,
    });
    const newTransfer = previewFeeCalculation({
      transactionType: "TRANSFER",
      role,
      amount,
      effectiveConfig: newConfig,
    });

    return {
      amount,
      qr_payment: {
        old_fee: oldQr.fee_amount,
        new_fee: newQr.fee_amount,
        old_net: oldQr.net_amount,
        new_net: newQr.net_amount,
      },
      transfer_outbound: {
        old_fee: oldTransfer.fee_amount,
        new_fee: newTransfer.fee_amount,
        old_total_debit: oldTransfer.total_debit_from_payer,
        new_total_debit: newTransfer.total_debit_from_payer,
      },
      withdraw: {
        old_fee: oldWithdraw.fee_amount,
        new_fee: newWithdraw.fee_amount,
        old_total_debit: oldWithdraw.total_debit_from_payer,
        new_total_debit: newWithdraw.total_debit_from_payer,
      },
    };
  });
}

function buildPersistableSystemConfig(merged) {
  return {
    rate_bps: merged.rate_bps,
    min_fee: merged.min_fee,
    max_fee: merged.max_fee,
    free_threshold_amount: merged.free_threshold_amount,
    transfer_fee_bps: merged.transfer_fee_bps ?? 0,
    transfer_min_fee: merged.transfer_min_fee ?? 0,
    transfer_max_fee: merged.transfer_max_fee ?? null,
    withdraw_fee_bps: merged.withdraw_fee_bps,
    withdraw_free_quota_per_month: merged.withdraw_free_quota_per_month,
    monthly_plan_enabled: merged.monthly_plan_enabled,
    monthly_plan_fee: merged.monthly_plan_fee,
    monthly_grace_days: merged.monthly_grace_days,
    tiers: Array.isArray(merged.tiers) ? merged.tiers : [],
  };
}

function mergeSystemUpdate(currentRaw, validated, role) {
  const current = normalizeSystemFeeConfig(currentRaw, role);
  const next = {
    rate_bps: validated.rate_bps !== undefined ? validated.rate_bps : current.rate_bps,
    min_fee: validated.min_fee !== undefined ? validated.min_fee : current.min_fee,
    max_fee:
      validated.max_fee_unbounded === true
        ? null
        : validated.max_fee !== undefined
          ? validated.max_fee
          : current.max_fee,
    free_threshold_amount:
      validated.free_threshold_amount !== undefined
        ? validated.free_threshold_amount
        : current.free_threshold_amount,
    transfer_fee_bps:
      validated.transfer_fee_bps !== undefined
        ? validated.transfer_fee_bps
        : current.transfer_fee_bps,
    transfer_min_fee:
      validated.transfer_min_fee !== undefined
        ? validated.transfer_min_fee
        : current.transfer_min_fee,
    transfer_max_fee:
      validated.transfer_max_fee_unbounded === true
        ? null
        : validated.transfer_max_fee !== undefined
          ? validated.transfer_max_fee
          : current.transfer_max_fee,
    withdraw_fee_bps:
      validated.withdraw_fee_bps !== undefined
        ? validated.withdraw_fee_bps
        : current.withdraw_fee_bps,
    withdraw_free_quota_per_month:
      validated.withdraw_free_quota_per_month !== undefined
        ? validated.withdraw_free_quota_per_month
        : current.withdraw_free_quota_per_month,
    monthly_plan_enabled:
      validated.monthly_plan_enabled !== undefined
        ? validated.monthly_plan_enabled
        : current.monthly_plan_enabled,
    monthly_plan_fee:
      validated.monthly_plan_fee !== undefined
        ? validated.monthly_plan_fee
        : current.monthly_plan_fee,
    monthly_grace_days:
      validated.monthly_grace_days !== undefined
        ? validated.monthly_grace_days
        : current.monthly_grace_days,
    tiers: validated.tiers !== undefined ? validated.tiers : current.tiers,
  };

  if (next.max_fee !== null && next.min_fee > next.max_fee) {
    throw httpError(
      400,
      `min_fee (${next.min_fee}) không được lớn hơn max_fee (${next.max_fee})`,
    );
  }
  if (next.transfer_max_fee !== null && next.transfer_min_fee > next.transfer_max_fee) {
    throw httpError(
      400,
      `transfer_min_fee (${next.transfer_min_fee}) không được lớn hơn transfer_max_fee (${next.transfer_max_fee})`,
    );
  }
  return buildPersistableSystemConfig(next);
}

function pickScheduleField(validatedValue, prevScheduleValue) {
  if (validatedValue !== undefined) {
    return validatedValue;
  }
  return prevScheduleValue !== undefined ? prevScheduleValue : null;
}

function buildScheduleOverrideRow(validated, prevSchedule, baseEffective) {
  const maxFeeUnbounded =
    validated.max_fee_unbounded !== undefined
      ? Boolean(validated.max_fee_unbounded)
      : validated.max_fee !== undefined
        ? validated.max_fee === null
        : Boolean(prevSchedule?.max_fee_unbounded);

  const transferMaxFeeUnbounded =
    validated.transfer_max_fee_unbounded !== undefined
      ? Boolean(validated.transfer_max_fee_unbounded)
      : validated.transfer_max_fee !== undefined
        ? validated.transfer_max_fee === null
        : Boolean(prevSchedule?.transfer_max_fee_unbounded);

  const row = {
    effective_from: validated.effective_from,
    rate_bps: pickScheduleField(validated.rate_bps, prevSchedule?.rate_bps),
    min_fee: pickScheduleField(validated.min_fee, prevSchedule?.min_fee),
    max_fee: maxFeeUnbounded
      ? null
      : pickScheduleField(validated.max_fee, prevSchedule?.max_fee),
    max_fee_unbounded: maxFeeUnbounded,
    free_threshold_amount: pickScheduleField(
      validated.free_threshold_amount,
      prevSchedule?.free_threshold_amount,
    ),
    transfer_fee_bps: pickScheduleField(
      validated.transfer_fee_bps,
      prevSchedule?.transfer_fee_bps,
    ),
    transfer_min_fee: pickScheduleField(
      validated.transfer_min_fee,
      prevSchedule?.transfer_min_fee,
    ),
    transfer_max_fee: transferMaxFeeUnbounded
      ? null
      : pickScheduleField(validated.transfer_max_fee, prevSchedule?.transfer_max_fee),
    transfer_max_fee_unbounded: transferMaxFeeUnbounded,
    withdraw_fee_bps: pickScheduleField(
      validated.withdraw_fee_bps,
      prevSchedule?.withdraw_fee_bps,
    ),
    withdraw_free_quota_per_month: pickScheduleField(
      validated.withdraw_free_quota_per_month,
      prevSchedule?.withdraw_free_quota_per_month,
    ),
    monthly_plan_enabled: pickScheduleField(
      validated.monthly_plan_enabled,
      prevSchedule?.monthly_plan_enabled,
    ),
    monthly_plan_fee: pickScheduleField(
      validated.monthly_plan_fee,
      prevSchedule?.monthly_plan_fee,
    ),
    tiers:
      validated.tiers !== undefined
        ? validated.tiers
        : Array.isArray(prevSchedule?.tiers)
          ? prevSchedule.tiers
          : [],
  };

  const effMin = row.min_fee !== null ? Number(row.min_fee) : baseEffective.min_fee;
  const effMax = row.max_fee_unbounded
    ? null
    : row.max_fee !== null
      ? Number(row.max_fee)
      : baseEffective.max_fee;
  if (effMax !== null && effMin > effMax) {
    throw httpError(
      400,
      `min_fee (${effMin}) không được lớn hơn max_fee (${effMax}) sau khi kế thừa biểu phí hiện tại`,
    );
  }

  const effTransferMin =
    row.transfer_min_fee !== null
      ? Number(row.transfer_min_fee)
      : baseEffective.transfer_min_fee ?? 0;
  const effTransferMax = row.transfer_max_fee_unbounded
    ? null
    : row.transfer_max_fee !== null
      ? Number(row.transfer_max_fee)
      : baseEffective.transfer_max_fee ?? null;
  if (effTransferMax !== null && effTransferMin > effTransferMax) {
    throw httpError(
      400,
      `transfer_min_fee (${effTransferMin}) không được lớn hơn transfer_max_fee (${effTransferMax}) sau khi kế thừa biểu phí hiện tại`,
    );
  }
  return row;
}

const adminMerchantFeeService = {
  DEFAULT_SAMPLE_AMOUNTS,

  async getDefaultFeeConfig({ role = "MERCHANT" } = {}) {
    const normalizedRole = normalizeRoleParam(role);
    const configKey =
      normalizedRole === "USER" ? "USER_FEE_CONFIG" : "MERCHANT_FEE_CONFIG";
    const rowRes = await pool.query(
      `SELECT key, value, description, updated_at, updated_by
         FROM system_configs
        WHERE key = $1
        LIMIT 1`,
      [configKey],
    );
    const row = rowRes.rows[0] || null;
    const normalized = normalizeSystemFeeConfig(
      row?.value ?? (await getSystemConfig(configKey, pool)),
      normalizedRole,
    );

    return {
      key: configKey,
      role: normalizedRole,
      config: normalized,
      description: row?.description || null,
      updated_at: row?.updated_at || null,
      updated_by: row?.updated_by || null,
    };
  },

  async previewDefaultFeeConfigUpdate({
    role = "MERCHANT",
    config = {},
    sampleAmounts = DEFAULT_SAMPLE_AMOUNTS,
    now = new Date(),
  }) {
    const normalizedRole = normalizeRoleParam(role);
    const current = await this.getDefaultFeeConfig({ role: normalizedRole });
    const validated = validateFeeConfigInput(config, {
      isOverride: false,
      now,
      baseConfig: current.config,
    });
    const proposedPlain = mergeSystemUpdate(current.config, validated, normalizedRole);
    const proposedNormalized = normalizeSystemFeeConfig(proposedPlain, normalizedRole);
    const samples = parseSampleAmounts(sampleAmounts);

    return {
      dry_run: true,
      key: current.key,
      role: normalizedRole,
      old_config: current.config,
      proposed_config: proposedNormalized,
      simulation: simulateFeeSamples({
        oldConfig: current.config,
        newConfig: proposedNormalized,
        role: normalizedRole,
        sampleAmounts: samples,
      }),
    };
  },

  async updateDefaultFeeConfig({
    role = "MERCHANT",
    config = {},
    reason,
    adminId,
    actorLabel = null,
    dryRun = false,
    sampleAmounts = DEFAULT_SAMPLE_AMOUNTS,
    now = new Date(),
  }) {
    const normalizedRole = normalizeRoleParam(role);
    const configKey =
      normalizedRole === "USER" ? "USER_FEE_CONFIG" : "MERCHANT_FEE_CONFIG";
    const samples = parseSampleAmounts(sampleAmounts);

    if (dryRun) {
      return this.previewDefaultFeeConfigUpdate({
        role: normalizedRole,
        config,
        sampleAmounts: samples,
        now,
      });
    }

    if (!adminId) {
      throw httpError(401, "Thiếu thông tin quản trị viên thực hiện");
    }
    const cleanReason = assertValidReason(reason);
    const actor = actorLabel || `admin:${adminId}`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const currentRes = await client.query(
        `SELECT key, value FROM system_configs WHERE key = $1 FOR UPDATE`,
        [configKey],
      );
      const oldPlain = buildPersistableSystemConfig(
        normalizeSystemFeeConfig(currentRes.rows[0]?.value, normalizedRole),
      );
      const oldNormalized = normalizeSystemFeeConfig(oldPlain, normalizedRole);

      const validated = validateFeeConfigInput(config, {
        isOverride: false,
        now,
        baseConfig: oldNormalized,
      });
      if (Object.keys(validated).length === 0) {
        throw httpError(400, "Không có trường cấu hình phí nào được cung cấp để cập nhật");
      }

      const newPlain = mergeSystemUpdate(oldPlain, validated, normalizedRole);
      const newNormalized = normalizeSystemFeeConfig(newPlain, normalizedRole);

      await client.query(
        `INSERT INTO system_configs (key, value, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3::uuid, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [configKey, JSON.stringify(newPlain), adminId],
      );

      const auditHistoryRes = await client.query(
        `INSERT INTO admin_user_change_history
           (admin_id, user_id, action, reason, old_values, new_values, created_at)
         VALUES ($1::uuid, $2::uuid, 'SYSTEM_FEE_CONFIG_UPDATED', $3, $4::jsonb, $5::jsonb, NOW())
         RETURNING id, action, reason, created_at`,
        [
          adminId,
          SYSTEM_FEE_WALLET_ID,
          cleanReason,
          JSON.stringify({ key: configKey, actor, config: oldPlain }),
          JSON.stringify({ key: configKey, actor, config: newPlain }),
        ],
      );

      await client.query(
        `INSERT INTO audit_outbox (id, event_type, payload, created_at)
         VALUES ($1::uuid, 'SYSTEM_FEE_CONFIG_UPDATED', $2::jsonb, NOW())`,
        [
          uuidv7(),
          JSON.stringify({
            key: configKey,
            role: normalizedRole,
            admin_id: adminId,
            actor,
            reason: cleanReason,
            old_values: oldPlain,
            new_values: newPlain,
          }),
        ],
      );

      await client.query("COMMIT");
      invalidateLimitsCache();

      console.info(
        `[admin-fee] SYSTEM_FEE_CONFIG_UPDATED key=${configKey} actor=${actor} rate_bps=${newPlain.rate_bps} withdraw_fee_bps=${newPlain.withdraw_fee_bps}`,
      );

      return {
        dry_run: false,
        key: configKey,
        role: normalizedRole,
        old_config: oldNormalized,
        new_config: newNormalized,
        audit: {
          ...auditHistoryRes.rows[0],
          actor,
        },
        simulation: simulateFeeSamples({
          oldConfig: oldNormalized,
          newConfig: newNormalized,
          role: normalizedRole,
          sampleAmounts: samples,
        }),
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async getMerchantFeeConfig(merchantId) {
    if (!merchantId || !UUID_RE.test(String(merchantId))) {
      throw httpError(400, "ID merchant không hợp lệ");
    }

    const userRes = await pool.query(
      `SELECT id, full_name, email, status, role, balance
         FROM users
        WHERE id = $1 AND role = 'MERCHANT'
        LIMIT 1`,
      [merchantId],
    );
    const merchant = userRes.rows[0];
    if (!merchant) {
      throw httpError(404, "Không tìm thấy tài khoản merchant");
    }

    const settingRes = await pool.query(
      `SELECT merchant_user_id, fee_plan, pending_fee_plan, expires_at, updated_at,
              monthly_plan_enabled, monthly_status, grace_until, overdue_month_key, overdue_amount
         FROM merchant_fee_settings
        WHERE merchant_user_id = $1
        LIMIT 1`,
      [merchantId],
    );

    const schedulesRes = await pool.query(
      `SELECT id, merchant_user_id, effective_from, rate_bps, min_fee, max_fee,
              max_fee_unbounded, free_threshold_amount,
              transfer_fee_bps, transfer_min_fee, transfer_max_fee, transfer_max_fee_unbounded,
              withdraw_fee_bps, withdraw_free_quota_per_month,
              monthly_plan_enabled, monthly_plan_fee,
              tiers, reason, created_by_actor, created_at
         FROM merchant_fee_schedules
        WHERE merchant_user_id = $1
        ORDER BY effective_from DESC, created_at DESC
        LIMIT 50`,
      [merchantId],
    );

    const systemConfig = await merchantFeeService.getSystemFeeConfig("MERCHANT", pool);
    const { effectiveSchedule, upcomingSchedule } = pickEffectiveSchedule(
      schedulesRes.rows,
      new Date(),
    );
    const effectiveConfig = mergeEffectiveFeeConfig(
      systemConfig,
      effectiveSchedule,
      "MERCHANT",
    );
    const withdrawQuota = await merchantFeeService.getWithdrawQuotaStatus(
      merchantId,
      { role: "MERCHANT", db: pool },
    );

    return {
      merchant: {
        id: merchant.id,
        full_name: merchant.full_name,
        status: merchant.status,
        balance: Number(merchant.balance),
      },
      plan_setting: settingRes.rows[0] || {
        merchant_user_id: merchantId,
        fee_plan: "PER_TRANSACTION",
        pending_fee_plan: null,
        expires_at: null,
        monthly_plan_enabled: false,
        monthly_status: "INACTIVE",
        overdue_amount: 0,
      },
      system_default_config: systemConfig,
      effective_config: effectiveConfig,
      effective_schedule: effectiveSchedule || null,
      upcoming_schedule: upcomingSchedule || null,
      schedules: schedulesRes.rows,
      withdraw_quota: {
        month_key: withdrawQuota.month_key,
        quota_per_month: withdrawQuota.quota_per_month,
        already_withdrawn: withdrawQuota.already_withdrawn,
        remaining_free_quota: withdrawQuota.remaining_free_quota,
      },
    };
  },

  async previewMerchantFeeConfigUpdate({
    merchantId,
    schedule = {},
    sampleAmounts = DEFAULT_SAMPLE_AMOUNTS,
    now = new Date(),
  }) {
    const current = await this.getMerchantFeeConfig(merchantId);
    const validated = validateFeeConfigInput(schedule, {
      isOverride: true,
      now,
      baseConfig: current.effective_config,
    });
    const mergedOverride = buildScheduleOverrideRow(
      validated,
      current.effective_schedule,
      current.effective_config,
    );
    const proposedSchedule = {
      id: "PREVIEW",
      ...mergedOverride,
      effective_from: mergedOverride.effective_from.toISOString(),
    };

    const proposedEffective = mergeEffectiveFeeConfig(
      current.system_default_config,
      proposedSchedule,
      "MERCHANT",
    );
    const samples = parseSampleAmounts(sampleAmounts);

    return {
      dry_run: true,
      merchant_id: merchantId,
      effective_from: proposedSchedule.effective_from,
      old_effective_config: current.effective_config,
      proposed_effective_config: proposedEffective,
      simulation: simulateFeeSamples({
        oldConfig: current.effective_config,
        newConfig: proposedEffective,
        role: "MERCHANT",
        alreadyWithdrawn: current.withdraw_quota.already_withdrawn,
        sampleAmounts: samples,
      }),
    };
  },

  async updateMerchantFeeConfig({
    merchantId,
    schedule = {},
    reason,
    adminId,
    actorLabel = null,
    dryRun = false,
    sampleAmounts = DEFAULT_SAMPLE_AMOUNTS,
    now = new Date(),
  }) {
    if (!merchantId || !UUID_RE.test(String(merchantId))) {
      throw httpError(400, "ID merchant không hợp lệ");
    }
    const samples = parseSampleAmounts(sampleAmounts);

    if (dryRun) {
      return this.previewMerchantFeeConfigUpdate({
        merchantId,
        schedule,
        sampleAmounts: samples,
        now,
      });
    }

    if (!adminId) {
      throw httpError(401, "Thiếu thông tin quản trị viên thực hiện");
    }
    const cleanReason = assertValidReason(reason);
    const actor = actorLabel || `admin:${adminId}`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const merchantRes = await client.query(
        `SELECT id, full_name, role, status, balance
           FROM users
          WHERE id = $1 AND role = 'MERCHANT'
          FOR UPDATE`,
        [merchantId],
      );
      const merchant = merchantRes.rows[0];
      if (!merchant) {
        throw httpError(404, "Không tìm thấy tài khoản merchant");
      }

      const systemConfig = await merchantFeeService.getSystemFeeConfig(
        "MERCHANT",
        client,
      );
      const existingSchedulesRes = await client.query(
        `SELECT id, merchant_user_id, effective_from, rate_bps, min_fee, max_fee,
                max_fee_unbounded, free_threshold_amount, withdraw_fee_bps,
                withdraw_free_quota_per_month, monthly_plan_enabled, monthly_plan_fee,
                tiers, reason, created_by_actor, created_at
           FROM merchant_fee_schedules
          WHERE merchant_user_id = $1
          ORDER BY effective_from DESC, created_at DESC`,
        [merchantId],
      );
      const { effectiveSchedule: prevSchedule } = pickEffectiveSchedule(
        existingSchedulesRes.rows,
        now,
      );
      const oldEffective = mergeEffectiveFeeConfig(
        systemConfig,
        prevSchedule,
        "MERCHANT",
      );

      const validated = validateFeeConfigInput(schedule, {
        isOverride: true,
        now,
        baseConfig: oldEffective,
      });

      const hasAnyField = [
        "rate_bps",
        "min_fee",
        "max_fee",
        "max_fee_unbounded",
        "free_threshold_amount",
        "transfer_fee_bps",
        "transfer_min_fee",
        "transfer_max_fee",
        "transfer_max_fee_unbounded",
        "withdraw_fee_bps",
        "withdraw_free_quota_per_month",
        "monthly_plan_enabled",
        "monthly_plan_fee",
        "tiers",
      ].some((k) => validated[k] !== undefined);

      if (!hasAnyField) {
        throw httpError(400, "Không có trường cấu hình phí nào được cung cấp");
      }

      const mergedOverride = buildScheduleOverrideRow(
        validated,
        prevSchedule,
        oldEffective,
      );

      const scheduleId = uuidv7();
      const insertedRes = await client.query(
        `INSERT INTO merchant_fee_schedules (
           id, merchant_user_id, effective_from, rate_bps, min_fee, max_fee,
           max_fee_unbounded, free_threshold_amount,
           transfer_fee_bps, transfer_min_fee, transfer_max_fee, transfer_max_fee_unbounded,
           withdraw_fee_bps, withdraw_free_quota_per_month,
           monthly_plan_enabled, monthly_plan_fee,
           tiers, reason, created_by_actor, created_at
         )
         VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, NOW())
         RETURNING *`,
        [
          scheduleId,
          merchantId,
          mergedOverride.effective_from,
          mergedOverride.rate_bps,
          mergedOverride.min_fee,
          mergedOverride.max_fee,
          Boolean(mergedOverride.max_fee_unbounded),
          mergedOverride.free_threshold_amount,
          mergedOverride.transfer_fee_bps,
          mergedOverride.transfer_min_fee,
          mergedOverride.transfer_max_fee,
          Boolean(mergedOverride.transfer_max_fee_unbounded),
          mergedOverride.withdraw_fee_bps,
          mergedOverride.withdraw_free_quota_per_month,
          mergedOverride.monthly_plan_enabled,
          mergedOverride.monthly_plan_fee,
          JSON.stringify(mergedOverride.tiers ?? []),
          cleanReason,
          actor,
        ],
      );
      const insertedSchedule = insertedRes.rows[0];

      const newEffective = mergeEffectiveFeeConfig(
        systemConfig,
        insertedSchedule,
        "MERCHANT",
      );

      const oldAuditPayload = {
        actor,
        schedule_id: prevSchedule?.id || null,
        effective_config: oldEffective,
      };
      const newAuditPayload = {
        actor,
        schedule_id: scheduleId,
        effective_from: new Date(insertedSchedule.effective_from).toISOString(),
        override: validated,
        effective_config: newEffective,
      };

      const auditHistoryRes = await client.query(
        `INSERT INTO admin_user_change_history
           (admin_id, user_id, action, reason, old_values, new_values, created_at)
         VALUES ($1::uuid, $2::uuid, 'MERCHANT_FEE_CONFIG_UPDATED', $3, $4::jsonb, $5::jsonb, NOW())
         RETURNING id, action, reason, created_at`,
        [
          adminId,
          merchantId,
          cleanReason,
          JSON.stringify(oldAuditPayload),
          JSON.stringify(newAuditPayload),
        ],
      );

      await client.query(
        `INSERT INTO audit_outbox (id, event_type, payload, created_at)
         VALUES ($1::uuid, 'MERCHANT_FEE_CONFIG_UPDATED', $2::jsonb, NOW())`,
        [
          uuidv7(),
          JSON.stringify({
            merchant_id: merchantId,
            admin_id: adminId,
            actor,
            reason: cleanReason,
            schedule_id: scheduleId,
            effective_from: new Date(insertedSchedule.effective_from).toISOString(),
            old_values: oldAuditPayload,
            new_values: newAuditPayload,
          }),
        ],
      );

      await client.query("COMMIT");
      invalidateLimitsCache();

      const withdrawQuota = await merchantFeeService.getWithdrawQuotaStatus(
        merchantId,
        { role: "MERCHANT", db: pool },
      );

      console.info(
        `[admin-fee] MERCHANT_FEE_CONFIG_UPDATED merchant=${merchantId} actor=${actor} schedule=${scheduleId} effective_from=${new Date(insertedSchedule.effective_from).toISOString()}`,
      );

      return {
        dry_run: false,
        merchant_id: merchantId,
        schedule: insertedSchedule,
        old_effective_config: oldEffective,
        new_effective_config: newEffective,
        audit: {
          ...auditHistoryRes.rows[0],
          actor,
        },
        simulation: simulateFeeSamples({
          oldConfig: oldEffective,
          newConfig: newEffective,
          role: "MERCHANT",
          alreadyWithdrawn: withdrawQuota.already_withdrawn,
          sampleAmounts: samples,
        }),
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async getFeeConfigHistory({
    merchantId = null,
    action = null,
    limit = 50,
    offset = 0,
  } = {}) {
    if (merchantId && !UUID_RE.test(String(merchantId))) {
      throw httpError(400, "merchant_id không hợp lệ");
    }
    const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    const allowedActions = [
      "MERCHANT_FEE_CONFIG_UPDATED",
      "SYSTEM_FEE_CONFIG_UPDATED",
    ];
    let actionFilter = allowedActions;
    if (action) {
      const normalized = String(action).trim().toUpperCase();
      if (!allowedActions.includes(normalized)) {
        throw httpError(400, "action lịch sử phí không hợp lệ");
      }
      actionFilter = [normalized];
    }

    const res = await pool.query(
      `SELECT ach.id, ach.admin_id, ach.user_id AS target_user_id, ach.action,
              ach.reason, ach.old_values, ach.new_values, ach.created_at,
              au.full_name AS admin_name, au.email AS admin_email,
              tu.full_name AS target_name, tu.role AS target_role
         FROM admin_user_change_history ach
         LEFT JOIN users au ON au.id = ach.admin_id
         LEFT JOIN users tu ON tu.id = ach.user_id
        WHERE ach.action = ANY($1::text[])
          AND ($2::uuid IS NULL OR ach.user_id = $2::uuid)
        ORDER BY ach.created_at DESC
        LIMIT $3 OFFSET $4`,
      [actionFilter, merchantId || null, safeLimit, safeOffset],
    );

    const items = res.rows.map((r) => ({
      id: r.id,
      action: r.action,
      reason: r.reason,
      actor: r.new_values?.actor || r.admin_email || r.admin_name || String(r.admin_id),
      admin: {
        id: r.admin_id,
        full_name: r.admin_name || null,
        email: r.admin_email || null,
      },
      target_merchant:
        r.action === "MERCHANT_FEE_CONFIG_UPDATED"
          ? {
              id: r.target_user_id,
              full_name: r.target_name || null,
            }
          : null,
      old_values: r.old_values,
      new_values: r.new_values,
      created_at: r.created_at,
    }));

    return { items, limit: safeLimit, offset: safeOffset };
  },
};

module.exports = adminMerchantFeeService;
