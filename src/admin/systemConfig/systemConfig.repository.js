// systemConfig.repository.js: Truy vấn, khóa cập nhật cấu hình hệ thống (system_configs) và lịch sử thay đổi Admin.
const pool = require("../../config/database");
const { recordAudit } = require("../../utils/db/audit");
const { insertAdminChangeHistoryTx } = require("../shared/adminAuditRepo");
const postpaidRepository = require("../../modules/postpaid/postpaid.repository");

const adminSystemConfigRepository = {
  async getPostpaidWalletImpactStats(proposedDefaultLimit, db = pool) {
    const res = await db.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN'))::int AS open_wallets_count,
        COUNT(*) FILTER (WHERE status = 'PAST_DUE')::int AS past_due_wallets_count,
        COALESCE(SUM(used_amount) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN')), 0)::bigint AS total_outstanding_debt,
        COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN') AND credit_limit <> $1)::int AS wallets_differing_from_default
      FROM postpaid_wallets
      `,
      [proposedDefaultLimit],
    );
    return res.rows[0] || {};
  },

  async listConfigsByKeys(keys, db = pool) {
    const res = await db.query(
      `
      SELECT sc.key, sc.value, sc.description, sc.updated_at, sc.updated_by,
             u.full_name AS updated_by_name
      FROM system_configs sc
      LEFT JOIN users u ON u.id = sc.updated_by
      WHERE sc.key = ANY($1::text[])
      `,
      [keys],
    );
    return res.rows;
  },

  async getConfigByKey(key, db = pool) {
    const res = await db.query(
      `
      SELECT sc.key, sc.value, sc.description, sc.updated_at, sc.updated_by,
             u.full_name AS updated_by_name
      FROM system_configs sc
      LEFT JOIN users u ON u.id = sc.updated_by
      WHERE sc.key = $1
      LIMIT 1
      `,
      [key],
    );
    return res.rows[0] || null;
  },

  async getConfigValueByKey(key, db = pool) {
    const res = await db.query(
      `SELECT key, value FROM system_configs WHERE key = $1 LIMIT 1`,
      [key],
    );
    return res.rows[0] || null;
  },

  async updateConfigWithHistory({
    validKey,
    proposedConfig,
    cleanReason,
    cleanAdminId,
    action,
    normalizeStored,
    computeDiff,
  }) {
    const client = await pool.connect();
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
        [validKey],
      );

      const oldConfig =
        lockRes.rowCount > 0
          ? normalizeStored(validKey, lockRes.rows[0].value)
          : null;
      const diff = computeDiff(oldConfig, proposedConfig);

      await client.query(
        `
        INSERT INTO system_configs (key, value, updated_by, updated_at)
        VALUES ($1, $2::jsonb, $3::uuid, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        `,
        [validKey, JSON.stringify(proposedConfig), cleanAdminId],
      );

      const oldValuesPayload = { key: validKey, config: oldConfig };
      const newValuesPayload = {
        key: validKey,
        config: proposedConfig,
        diff: diff.changes,
      };

      const historyRow = await insertAdminChangeHistoryTx(client, {
        adminId: cleanAdminId,
        userId: walletId,
        action,
        reason: cleanReason,
        oldValues: oldValuesPayload,
        newValues: newValuesPayload,
      });

      await recordAudit(client, {
        eventType: action,
        payload: {
          audit_id: historyRow.id,
          key: validKey,
          admin_id: cleanAdminId,
          target_wallet_id: walletId,
          reason: cleanReason,
          diff: diff.changes,
          old_config: oldConfig,
          new_config: proposedConfig,
        },
      });

      await client.query("COMMIT");
      return { walletId, oldConfig, diff, historyRow };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  },

  async getConfigHistory({ action, filterKey, limit, offset }, db = pool) {
    const whereSql = `
      ach.action = $1
      AND COALESCE(ach.new_values->>'key', ach.old_values->>'key') = $2
    `;
    const params = [action, filterKey];

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
        [...params, limit, offset],
      ),
      db.query(
        `
        SELECT COUNT(*)::int AS total
        FROM admin_user_change_history ach
        WHERE ${whereSql}
        `,
        params,
      ),
    ]);

    return {
      totalItems: Number(countRes.rows[0]?.total || 0),
      rows: itemsRes.rows,
    };
  },
};

module.exports = adminSystemConfigRepository;

