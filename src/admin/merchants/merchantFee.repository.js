// merchantFee.repository.js: Truy vấn và cập nhật cấu hình biểu phí hệ thống cùng lịch sử audit cho Admin.
const pool = require("../../config/database");
const { httpError } = require("../../utils/common/http");
const { recordAudit } = require("../../utils/db/audit");
const { insertAdminChangeHistoryTx } = require("../shared/adminAuditRepo");
const merchantFeeService = require("../../modules/merchant/production/fee/fee.service");
const {
  normalizeSystemFeeConfig,
  validateFeeConfigInput,
} = require("../../modules/fee/feeCalculator");
const {
  buildPersistableSystemConfig,
  mergeSystemUpdate,
} = require("./merchantFee.helpers");

const adminMerchantFeeRepository = {
  async getSystemFeeConfigRow(configKey, db = pool) {
    const rowRes = await db.query(
      `SELECT key, value, description, updated_at, updated_by
         FROM system_configs
        WHERE key = $1
        LIMIT 1`,
      [configKey],
    );
    return rowRes.rows[0] || null;
  },

  async getMerchantSummaryById(merchantId, db = pool) {
    const userRes = await db.query(
      `SELECT id, full_name, email, status, role, balance
         FROM users
        WHERE id = $1 AND role = 'MERCHANT'
        LIMIT 1`,
      [merchantId],
    );
    return userRes.rows[0] || null;
  },

  async updateDefaultFeeConfigTx({
    configKey,
    normalizedRole,
    config,
    adminId,
    cleanReason,
    actor,
    now,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const currentRes = await client.query(
        `SELECT key, value FROM system_configs WHERE key = $1 FOR UPDATE`,
        [configKey],
      );
      if (!currentRes.rows[0]) {
        const roleLabel = normalizedRole === "USER" ? "người dùng" : "đối tác";
        throw httpError(500, `Hệ thống chưa có cấu hình biểu phí ${roleLabel}`);
      }
      const oldPlain = buildPersistableSystemConfig(
        normalizeSystemFeeConfig(currentRes.rows[0].value, normalizedRole),
      );
      const oldNormalized = normalizeSystemFeeConfig(oldPlain, normalizedRole);

      const validated = validateFeeConfigInput(config, {
        isOverride: false,
        now,
        baseConfig: oldNormalized,
      });
      if (Object.keys(validated).length === 0) {
        throw httpError(
          400,
          "Không có trường cấu hình phí nào được cung cấp để cập nhật",
        );
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

      const { walletId: feeWalletId } =
        await merchantFeeService.verifySystemFeeWallet(client);

      const auditRow = await insertAdminChangeHistoryTx(client, {
        adminId,
        userId: feeWalletId,
        action: "SYSTEM_FEE_CONFIG_UPDATED",
        reason: cleanReason,
        oldValues: { key: configKey, actor, config: oldPlain },
        newValues: { key: configKey, actor, config: newPlain },
      });

      await recordAudit(client, {
        eventType: "SYSTEM_FEE_CONFIG_UPDATED",
        payload: {
          key: configKey,
          role: normalizedRole,
          admin_id: adminId,
          actor,
          reason: cleanReason,
          old_values: oldPlain,
          new_values: newPlain,
        },
      });

      await client.query("COMMIT");
      return { oldNormalized, newPlain, newNormalized, auditRow };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async getFeeConfigHistory(
    { actionFilter, merchantId = null, keyFilter = null, limit, offset },
    db = pool,
  ) {
    const filterParams = [actionFilter, merchantId || null, keyFilter];
    const whereClause = `
        WHERE ach.action = ANY($1::text[])
          AND ($2::uuid IS NULL OR ach.user_id = $2::uuid)
          AND ($3::text IS NULL OR (ach.new_values->>'key') = $3::text)
    `;

    const [countRes, res] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total_items
           FROM admin_user_change_history ach
          ${whereClause}`,
        filterParams,
      ),
      db.query(
        `SELECT ach.id, ach.admin_id, ach.user_id AS target_user_id, ach.action,
                ach.reason, ach.old_values, ach.new_values, ach.created_at,
                au.full_name AS admin_name, au.email AS admin_email,
                tu.full_name AS target_name, tu.role AS target_role
           FROM admin_user_change_history ach
           LEFT JOIN users au ON au.id = ach.admin_id
           LEFT JOIN users tu ON tu.id = ach.user_id
          ${whereClause}
          ORDER BY ach.created_at DESC
          LIMIT $4 OFFSET $5`,
        [...filterParams, limit, offset],
      ),
    ]);

    return {
      totalItems: Number(countRes.rows[0]?.total_items || 0),
      rows: res.rows,
    };
  },
};

module.exports = adminMerchantFeeRepository;

