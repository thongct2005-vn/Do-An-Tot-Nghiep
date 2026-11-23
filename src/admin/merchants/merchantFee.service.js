// merchantFee.service.js: Nghiệp vụ xem, mô phỏng và cập nhật biểu phí mặc định hệ thống (USER/MERCHANT) cùng lịch sử Admin.
const pool = require("../../config/database");
const { httpError } = require("../../utils/common/http");
const { UUID_REGEX } = require("../../utils/common/validators");
const { invalidateLimitsCache } = require("../../utils/limits/limitsDb");
const { assertValidReason, parseAdminPagination } = require("../shared/adminHelpers");
const merchantFeeService = require("../../modules/merchant/production/fee/fee.service");
const {
  normalizeSystemFeeConfig,
  validateFeeConfigInput,
  mergeEffectiveFeeConfig,
} = require("../../modules/fee/feeCalculator");
const adminMerchantFeeRepository = require("./merchantFee.repository");
const {
  DEFAULT_SAMPLE_AMOUNTS,
  ALLOWED_FEE_AUDIT_ACTIONS,
  ALLOWED_FEE_CONFIG_KEYS,
  normalizeRoleParam,
  parseSampleAmounts,
  simulateFeeSamples,
  mergeSystemUpdate,
} = require("./merchantFee.helpers");

const adminMerchantFeeService = {
  DEFAULT_SAMPLE_AMOUNTS,

  async getDefaultFeeConfig({ role = "MERCHANT" } = {}) {
    const normalizedRole = normalizeRoleParam(role);
    const configKey =
      normalizedRole === "USER" ? "USER_FEE_CONFIG" : "MERCHANT_FEE_CONFIG";

    const row =
      await adminMerchantFeeRepository.getSystemFeeConfigRow(configKey);
    if (!row) {
      const roleLabel = normalizedRole === "USER" ? "người dùng" : "đối tác";
      throw httpError(500, `Hệ thống chưa có cấu hình biểu phí ${roleLabel}`);
    }
    const normalized = normalizeSystemFeeConfig(row.value, normalizedRole);

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
    const proposedPlain = mergeSystemUpdate(
      current.config,
      validated,
      normalizedRole,
    );
    const proposedNormalized = normalizeSystemFeeConfig(
      proposedPlain,
      normalizedRole,
    );
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
    const cleanReason = assertValidReason(reason, {
      min: 5,
      max: 500,
      requiredMessage: "Vui lòng nhập lý do cập nhật cấu hình phí",
      lengthMessage: "Lý do thay đổi cấu hình phí phải từ 5 đến 500 ký tự",
    });
    const actor = actorLabel || `admin:${adminId}`;

    const { oldNormalized, newPlain, newNormalized, auditRow } =
      await adminMerchantFeeRepository.updateDefaultFeeConfigTx({
        configKey,
        normalizedRole,
        config,
        adminId,
        cleanReason,
        actor,
        now,
      });

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
        ...auditRow,
        actor,
      },
      simulation: simulateFeeSamples({
        oldConfig: oldNormalized,
        newConfig: newNormalized,
        role: normalizedRole,
        sampleAmounts: samples,
      }),
    };
  },

  async getMerchantFeeConfig(merchantId) {
    if (!merchantId || !UUID_REGEX.test(String(merchantId))) {
      throw httpError(400, "ID merchant không hợp lệ");
    }

    const merchant =
      await adminMerchantFeeRepository.getMerchantSummaryById(merchantId);
    if (!merchant) {
      throw httpError(404, "Không tìm thấy tài khoản merchant");
    }

    const systemConfig = await merchantFeeService.getSystemFeeConfig(
      "MERCHANT",
      pool,
    );
    const effectiveConfig = mergeEffectiveFeeConfig(
      systemConfig,
      null,
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
      plan_setting: {
        merchant_user_id: merchantId,
        fee_plan: "PER_TRANSACTION",
      },
      system_default_config: systemConfig,
      effective_config: effectiveConfig,
      effective_schedule: null,
      upcoming_schedule: null,
      schedules: [],
      withdraw_quota: {
        month_key: withdrawQuota.month_key,
        quota_per_month: withdrawQuota.quota_per_month,
        already_withdrawn: withdrawQuota.already_withdrawn,
        remaining_free_quota: withdrawQuota.remaining_free_quota,
      },
    };
  },

  async getFeeConfigHistory({
    merchantId = null,
    action = null,
    key = null,
    limit = 50,
    offset = 0,
  } = {}) {
    if (merchantId && !UUID_REGEX.test(String(merchantId))) {
      throw httpError(400, "Định danh đối tác không hợp lệ");
    }
    const { limitNum: safeLimit } = parseAdminPagination(1, limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    let actionFilter = ALLOWED_FEE_AUDIT_ACTIONS;
    if (action) {
      const normalized = String(action).trim().toUpperCase();
      if (!ALLOWED_FEE_AUDIT_ACTIONS.includes(normalized)) {
        throw httpError(400, "Loại thao tác lịch sử phí không hợp lệ");
      }
      actionFilter = [normalized];
    }

    let keyFilter = null;
    if (key !== null && key !== undefined && String(key).trim() !== "") {
      const normalizedKey = String(key).trim().toUpperCase();
      if (!ALLOWED_FEE_CONFIG_KEYS.includes(normalizedKey)) {
        throw httpError(400, "Khóa cấu hình biểu phí không hợp lệ");
      }
      keyFilter = normalizedKey;
    }

    const { totalItems, rows } =
      await adminMerchantFeeRepository.getFeeConfigHistory({
        actionFilter,
        merchantId,
        keyFilter,
        limit: safeLimit,
        offset: safeOffset,
      });

    const items = rows.map((r) => ({
      id: r.id,
      action: r.action,
      reason: r.reason,
      actor:
        r.new_values?.actor ||
        r.admin_email ||
        r.admin_name ||
        String(r.admin_id),
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

    return {
      items,
      limit: safeLimit,
      offset: safeOffset,
      total_items: totalItems,
      pagination: {
        total_items: totalItems,
        limit: safeLimit,
        offset: safeOffset,
      },
    };
  },
};

module.exports = adminMerchantFeeService;
