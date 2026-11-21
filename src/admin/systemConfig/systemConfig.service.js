const pool = require("../../config/database");
const { uuidv7 } = require("uuidv7");
const { httpError } = require("../../utils/httpError");
const { invalidateLimitsCache } = require("../../utils/limits/limitsDb");
const postpaidRepository = require("../../modules/postpaid/postpaid.repository");
const {
  POSTPAID_LATE_FEE_TIERS,
} = require("../../modules/postpaid/postpaidConfig");
const {
  SYSTEM_CONFIG_KEYS,
  ALLOWED_SYSTEM_CONFIG_KEYS,
  assertAllowedSystemConfigKey,
  validateSystemConfigInput,
  normalizeStoredSystemConfig,
  buildConfigDiff,
} = require("./systemConfig.validators");

const SYSTEM_CONFIG_UPDATED_ACTION = "SYSTEM_CONFIG_UPDATED";
const SAMPLE_OVERDUE_AMOUNT_VND = 1000000;

const POSTPAID_CONFIG_METADATA = Object.freeze({
  label: "Cấu hình Ví trả sau (BNPL)",
  effective_scope:
    "Áp dụng cho lượt mở ví trả sau mới và các lượt chạy job chốt sao kê / tính phí sắp tới theo múi giờ Việt Nam (UTC+7); không hồi tố các sao kê đã chốt.",
});

function assertValidReason(rawReason) {
  if (typeof rawReason !== "string") {
    throw httpError(400, "Vui lòng nhập lý do thay đổi cấu hình Ví trả sau");
  }
  const clean = rawReason.trim();
  if (clean.length < 5 || clean.length > 500) {
    throw httpError(
      400,
      "Lý do thay đổi cấu hình Ví trả sau phải từ 5 đến 500 ký tự"
    );
  }
  return clean;
}

function assertValidAdminId(adminId) {
  const clean = String(adminId || "").trim();
  if (!clean) {
    throw httpError(
      401,
      "Không xác định được tài khoản quản trị viên thực hiện thao tác"
    );
  }
  return clean;
}

async function analyzePostpaidConfigImpact(oldConfig, proposedConfig, db) {
  const vnNow = postpaidRepository.getVnDateMeta();
  const walletStatsRes = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN'))::int AS open_wallets_count,
      COUNT(*) FILTER (WHERE status = 'PAST_DUE')::int AS past_due_wallets_count,
      COALESCE(SUM(used_amount) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN')), 0)::bigint AS total_outstanding_debt,
      COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN') AND credit_limit <> $1)::int AS wallets_differing_from_default
    FROM postpaid_wallets
    `,
    [proposedConfig.default_credit_limit]
  );

  const stats = walletStatsRes.rows[0] || {};
  const computeTierFee = (bps) =>
    Math.round((SAMPLE_OVERDUE_AMOUNT_VND * Number(bps || 0)) / 10000);

  const tierSimulations = POSTPAID_LATE_FEE_TIERS.map((tierSpec) => {
    const oldBps = oldConfig ? Number(oldConfig[tierSpec.key] || 0) : 0;
    const proposedBps = Number(proposedConfig[tierSpec.key] || 0);
    return {
      tier: tierSpec.tier,
      key: tierSpec.key,
      label: tierSpec.label,
      old_bps: oldBps,
      proposed_bps: proposedBps,
      old_fee: oldConfig ? computeTierFee(oldBps) : 0,
      proposed_fee: computeTierFee(proposedBps),
    };
  });

  const oldSampleLateFee = tierSimulations[0].old_fee;
  const proposedSampleLateFee = tierSimulations[0].proposed_fee;

  const warnings = [];
  if (!proposedConfig.enabled) {
    warnings.push(
      "Ví trả sau sẽ ở trạng thái TẮT (enabled = false): người dùng không thể kích hoạt ví mới hoặc thanh toán bằng Ví trả sau, nhưng vẫn trả nợ bình thường."
    );
  }
  if (oldConfig && proposedConfig.billing_day !== oldConfig.billing_day) {
    const earliestDay = Math.min(
      oldConfig.billing_day,
      proposedConfig.billing_day
    );
    if (vnNow.day >= earliestDay) {
      warnings.push(
        `Hôm nay là ngày ${vnNow.day}/${vnNow.month}/${vnNow.year} (giờ VN) và đã qua/đang tại mốc ngày ${earliestDay}. Thay đổi billing_day từ ${oldConfig.billing_day} sang ${proposedConfig.billing_day} chỉ áp dụng cho các lượt chạy job chu kỳ tiếp theo, không hồi tố sao kê đã chốt.`
      );
    } else {
      warnings.push(
        `billing_day mới (${proposedConfig.billing_day}) sẽ áp dụng cho kỳ chốt sao kê ${vnNow.cycleMonth} nếu chạy từ ngày ${proposedConfig.billing_day} trở đi.`
      );
    }
  }
  if (proposedConfig.due_day <= proposedConfig.billing_day) {
    warnings.push(
      `due_day (${proposedConfig.due_day}) <= billing_day (${proposedConfig.billing_day}): ngày đến hạn thanh toán được tính vào ngày ${proposedConfig.due_day} của tháng kế tiếp sau kỳ chốt sao kê.`
    );
  }
  if (proposedConfig.min_account_days === 0) {
    warnings.push(
      "min_account_days = 0 sẽ được runtime kẹp tối thiểu 1 ngày khi xét điều kiện mở Ví trả sau."
    );
  }

  return {
    simulation: {
      vn_current_date: `${vnNow.year}-${String(vnNow.month).padStart(2, "0")}-${String(vnNow.day).padStart(2, "0")}`,
      vn_cycle_month: vnNow.cycleMonth,
      open_wallets_count: Number(stats.open_wallets_count || 0),
      past_due_wallets_count: Number(stats.past_due_wallets_count || 0),
      total_outstanding_debt: Number(stats.total_outstanding_debt || 0),
      wallets_differing_from_default: Number(
        stats.wallets_differing_from_default || 0
      ),
      sample_overdue_debt: SAMPLE_OVERDUE_AMOUNT_VND,
      old_sample_late_fee: oldSampleLateFee,
      proposed_sample_late_fee: proposedSampleLateFee,
      tier_simulations: tierSimulations,
    },
    warnings,
  };
}

function formatConfigRow(row) {
  const validKey = SYSTEM_CONFIG_KEYS.POSTPAID_CONFIG;
  return {
    key: validKey,
    label: POSTPAID_CONFIG_METADATA.label,
    effective_scope: POSTPAID_CONFIG_METADATA.effective_scope,
    config: normalizeStoredSystemConfig(validKey, row.value),
    description: row.description || null,
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
    updated_by_name: row.updated_by_name || null,
  };
}

const adminSystemConfigService = {
  /**
   * Lists supported system configurations (POSTPAID_CONFIG).
   */
  async listConfigs(db = pool) {
    const res = await db.query(
      `
      SELECT sc.key, sc.value, sc.description, sc.updated_at, sc.updated_by,
             u.full_name AS updated_by_name
      FROM system_configs sc
      LEFT JOIN users u ON u.id = sc.updated_by
      WHERE sc.key = ANY($1::text[])
      `,
      [ALLOWED_SYSTEM_CONFIG_KEYS]
    );
    const byKey = new Map(res.rows.map((r) => [r.key, r]));
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
    const res = await db.query(
      `
      SELECT sc.key, sc.value, sc.description, sc.updated_at, sc.updated_by,
             u.full_name AS updated_by_name
      FROM system_configs sc
      LEFT JOIN users u ON u.id = sc.updated_by
      WHERE sc.key = $1
      LIMIT 1
      `,
      [validKey]
    );
    if (res.rowCount === 0) {
      throw httpError(
        404,
        `Không tìm thấy cấu hình '${validKey}' trong hệ thống`
      );
    }
    return formatConfigRow(res.rows[0]);
  },

  /**
   * Validates proposed POSTPAID_CONFIG and simulates VN billing impact without writing to DB.
   */
  async previewConfigUpdate(key, rawConfig, db = pool) {
    const validKey = assertAllowedSystemConfigKey(key);
    const proposedConfig = validateSystemConfigInput(validKey, rawConfig);

    const existingRes = await db.query(
      `SELECT key, value FROM system_configs WHERE key = $1 LIMIT 1`,
      [validKey]
    );
    if (existingRes.rowCount === 0) {
      throw httpError(
        404,
        `Không tìm thấy cấu hình '${validKey}' trong hệ thống`
      );
    }

    const oldConfig = normalizeStoredSystemConfig(
      validKey,
      existingRes.rows[0].value
    );
    const diff = buildConfigDiff(oldConfig, proposedConfig);
    const { simulation, warnings } = await analyzePostpaidConfigImpact(
      oldConfig,
      proposedConfig,
      db
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

    const cleanReason = assertValidReason(reason);
    const cleanAdminId = assertValidAdminId(adminId);
    const proposedConfig = validateSystemConfigInput(validKey, config);

    const client = await pool.connect();
    let committedResult = null;

    try {
      await client.query("BEGIN");

      const { walletId } =
        await postpaidRepository.verifySystemPostpaidWallet(client);

      const lockRes = await client.query(
        `
        SELECT key, value, description
        FROM system_configs
        WHERE key = $1
        FOR UPDATE
        `,
        [validKey]
      );

      const oldConfig =
        lockRes.rowCount > 0
          ? normalizeStoredSystemConfig(validKey, lockRes.rows[0].value)
          : null;
      const diff = buildConfigDiff(oldConfig, proposedConfig);

      await client.query(
        `
        INSERT INTO system_configs (key, value, updated_by, updated_at)
        VALUES ($1, $2::jsonb, $3::uuid, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        `,
        [validKey, JSON.stringify(proposedConfig), cleanAdminId]
      );

      const oldValuesPayload = {
        key: validKey,
        config: oldConfig,
      };
      const newValuesPayload = {
        key: validKey,
        config: proposedConfig,
        diff: diff.changes,
      };

      const historyRes = await client.query(
        `
        INSERT INTO admin_user_change_history
          (admin_id, user_id, action, reason, old_values, new_values, created_at)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, NOW())
        RETURNING id, action, reason, created_at
        `,
        [
          cleanAdminId,
          walletId,
          SYSTEM_CONFIG_UPDATED_ACTION,
          cleanReason,
          JSON.stringify(oldValuesPayload),
          JSON.stringify(newValuesPayload),
        ]
      );
      const historyRow = historyRes.rows[0];

      await client.query(
        `
        INSERT INTO audit_outbox (id, event_type, payload, created_at)
        VALUES ($1::uuid, $2, $3::jsonb, NOW())
        `,
        [
          uuidv7(),
          SYSTEM_CONFIG_UPDATED_ACTION,
          JSON.stringify({
            audit_id: historyRow.id,
            key: validKey,
            admin_id: cleanAdminId,
            target_wallet_id: walletId,
            reason: cleanReason,
            diff: diff.changes,
            old_config: oldConfig,
            new_config: proposedConfig,
          }),
        ]
      );

      await client.query("COMMIT");

      committedResult = {
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
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw error;
    } finally {
      client.release();
    }

    invalidateLimitsCache();
    return committedResult;
  },

  /**
   * Lists SYSTEM_CONFIG_UPDATED audit history records for POSTPAID_CONFIG.
   */
  async getConfigHistory({ key = null, limit = 20, offset = 0 } = {}, db = pool) {
    let filterKey = SYSTEM_CONFIG_KEYS.POSTPAID_CONFIG;
    if (key !== null && key !== undefined && String(key).trim() !== "") {
      filterKey = assertAllowedSystemConfigKey(String(key).trim());
    }

    const parsedLimit = Number.parseInt(limit, 10);
    const parsedOffset = Number.parseInt(offset, 10);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;
    const safeOffset = Number.isFinite(parsedOffset)
      ? Math.max(parsedOffset, 0)
      : 0;

    const whereSql = `
      ach.action = $1
      AND COALESCE(ach.new_values->>'key', ach.old_values->>'key') = $2
    `;
    const params = [SYSTEM_CONFIG_UPDATED_ACTION, filterKey];

    const [itemsRes, countRes] = await Promise.all([
      db.query(
        `
        SELECT
          ach.id,
          ach.admin_id,
          admin_user.full_name AS admin_name,
          admin_user.phone AS admin_phone,
          ach.user_id AS anchor_wallet_id,
          ach.action,
          ach.reason,
          ach.old_values,
          ach.new_values,
          ach.created_at
        FROM admin_user_change_history ach
        LEFT JOIN users admin_user ON admin_user.id = ach.admin_id
        WHERE ${whereSql}
        ORDER BY ach.created_at DESC, ach.id DESC
        LIMIT $3 OFFSET $4
        `,
        [...params, safeLimit, safeOffset]
      ),
      db.query(
        `
        SELECT COUNT(*)::int AS total
        FROM admin_user_change_history ach
        WHERE ${whereSql}
        `,
        params
      ),
    ]);

    const totalItems = Number(countRes.rows[0]?.total || 0);
    const items = itemsRes.rows.map((row) => ({
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
