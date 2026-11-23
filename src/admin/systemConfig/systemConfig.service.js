// systemConfig.service.js: Nghiệp vụ đọc, mô phỏng tác động và cập nhật cấu hình hệ thống (POSTPAID_CONFIG).
const pool = require("../../config/database");
const { httpError } = require("../../utils/common/http");
const { invalidateLimitsCache } = require("../../utils/limits/limitsDb");
const {
  assertValidReason,
  parseAdminPagination,
} = require("../shared/adminHelpers");
const {
  SYSTEM_CONFIG_KEYS,
  ALLOWED_SYSTEM_CONFIG_KEYS,
  assertAllowedSystemConfigKey,
  validateSystemConfigInput,
  normalizeStoredSystemConfig,
  buildConfigDiff,
} = require("./systemConfig.validators");
const adminSystemConfigRepository = require("./systemConfig.repository");
const {
  SYSTEM_CONFIG_UPDATED_ACTION,
  POSTPAID_CONFIG_METADATA,
  buildPostpaidConfigImpact,
  formatConfigRow,
  assertValidPostpaidConfigAdminId,
} = require("./systemConfig.helpers");

const adminSystemConfigService = {
  /**
   * Lists supported system configurations (POSTPAID_CONFIG).
   */
  async listConfigs(db = pool) {
    const rows = await adminSystemConfigRepository.listConfigsByKeys(
      ALLOWED_SYSTEM_CONFIG_KEYS,
      db,
    );
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const items = ALLOWED_SYSTEM_CONFIG_KEYS.map((key) => {
      const row = byKey.get(key);
      if (!row) {
        return {
          key,
          label: POSTPAID_CONFIG_METADATA.label,
          effective_scope: POSTPAID_CONFIG_METADATA.effective_scope,
          config: null,
          description: null,
          updated_at: null,
          updated_by: null,
          updated_by_name: null,
          missing: true,
        };
      }
      return formatConfigRow(row);
    });
    return { items };
  },

  /**
   * Reads and normalizes POSTPAID_CONFIG from system_configs.
   */
  async getConfig(key, db = pool) {
    const validKey = assertAllowedSystemConfigKey(key);
    const row = await adminSystemConfigRepository.getConfigByKey(validKey, db);
    if (!row) {
      throw httpError(
        404,
        `Không tìm thấy cấu hình '${validKey}' trong hệ thống`,
      );
    }
    return formatConfigRow(row);
  },

  /**
   * Validates proposed POSTPAID_CONFIG and simulates VN billing impact without writing to DB.
   */
  async previewConfigUpdate(key, rawConfig, db = pool) {
    const validKey = assertAllowedSystemConfigKey(key);
    const proposedConfig = validateSystemConfigInput(validKey, rawConfig);

    const existing = await adminSystemConfigRepository.getConfigValueByKey(
      validKey,
      db,
    );
    if (!existing) {
      throw httpError(
        404,
        `Không tìm thấy cấu hình '${validKey}' trong hệ thống`,
      );
    }

    const oldConfig = normalizeStoredSystemConfig(validKey, existing.value);
    const diff = buildConfigDiff(oldConfig, proposedConfig);
    const stats =
      await adminSystemConfigRepository.getPostpaidWalletImpactStats(
        proposedConfig.default_credit_limit,
        db,
      );
    const { simulation, warnings } = buildPostpaidConfigImpact(
      oldConfig,
      proposedConfig,
      stats,
    );

    return {
      key: validKey,
      label: POSTPAID_CONFIG_METADATA.label,
      effective_scope: POSTPAID_CONFIG_METADATA.effective_scope,
      dry_run: true,
      has_changes: diff.has_changes,
      changed_count: diff.changed_count,
      old_config: oldConfig,
      proposed_config: proposedConfig,
      diff,
      simulation,
      warnings,
    };
  },

  /**
   * Atomically updates POSTPAID_CONFIG, writing audit history anchored to SYSTEM_POSTPAID_WALLET.
   */
  async updateConfig({ key, config, reason, adminId, dryRun = false }) {
    const validKey = assertAllowedSystemConfigKey(key);
    if (dryRun) {
      return adminSystemConfigService.previewConfigUpdate(validKey, config);
    }

    const cleanReason = assertValidReason(reason, {
      min: 5,
      max: 500,
      requiredMessage: "Vui lòng nhập lý do thay đổi cấu hình Ví trả sau",
      lengthMessage:
        "Lý do thay đổi cấu hình Ví trả sau phải từ 5 đến 500 ký tự",
    });
    const cleanAdminId = assertValidPostpaidConfigAdminId(adminId);
    const proposedConfig = validateSystemConfigInput(validKey, config);

    const { walletId, oldConfig, diff, historyRow } =
      await adminSystemConfigRepository.updateConfigWithHistory({
        validKey,
        proposedConfig,
        cleanReason,
        cleanAdminId,
        action: SYSTEM_CONFIG_UPDATED_ACTION,
        normalizeStored: normalizeStoredSystemConfig,
        computeDiff: buildConfigDiff,
      });

    invalidateLimitsCache();

    return {
      key: validKey,
      label: POSTPAID_CONFIG_METADATA.label,
      effective_scope: POSTPAID_CONFIG_METADATA.effective_scope,
      dry_run: false,
      updated: true,
      audit_id: historyRow.id,
      audit_action: historyRow.action,
      anchor_wallet_id: walletId,
      reason: historyRow.reason,
      has_changes: diff.has_changes,
      changed_count: diff.changed_count,
      old_config: oldConfig,
      config: proposedConfig,
      diff,
      created_at: historyRow.created_at,
    };
  },

  /**
   * Lists SYSTEM_CONFIG_UPDATED audit history records for POSTPAID_CONFIG.
   */
  async getConfigHistory({ key = null, limit = 20, offset = 0 } = {}, db = pool) {
    let filterKey = SYSTEM_CONFIG_KEYS.POSTPAID_CONFIG;
    if (key !== null && key !== undefined && String(key).trim() !== "") {
      filterKey = assertAllowedSystemConfigKey(String(key).trim());
    }

    const { limitNum: safeLimit } = parseAdminPagination(1, limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const parsedOffset = Number.parseInt(offset, 10);
    const safeOffset = Number.isFinite(parsedOffset)
      ? Math.max(parsedOffset, 0)
      : 0;

    const { totalItems, rows } =
      await adminSystemConfigRepository.getConfigHistory(
        {
          action: SYSTEM_CONFIG_UPDATED_ACTION,
          filterKey,
          limit: safeLimit,
          offset: safeOffset,
        },
        db,
      );

    const items = rows.map((row) => ({
      id: row.id,
      key: row.new_values?.key || row.old_values?.key || null,
      action: row.action,
      reason: row.reason,
      admin_id: row.admin_id,
      admin_name: row.admin_name || null,
      admin_phone: row.admin_phone || null,
      anchor_wallet_id: row.anchor_wallet_id,
      old_values: row.old_values,
      new_values: row.new_values,
      created_at: row.created_at,
    }));

    return {
      items,
      total_items: totalItems,
      pagination: {
        limit: safeLimit,
        offset: safeOffset,
        total_items: totalItems,
        has_more: safeOffset + items.length < totalItems,
      },
    };
  },
};

module.exports = adminSystemConfigService;
module.exports.SYSTEM_CONFIG_UPDATED_ACTION = SYSTEM_CONFIG_UPDATED_ACTION;
