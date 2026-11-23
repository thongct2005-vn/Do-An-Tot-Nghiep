// adminAuditRepo.js: Hàm ghi nhận lịch sử thay đổi Admin (admin_user_change_history) và audit outbox dùng chung.
const { recordAudit } = require("../../utils/db/audit");

async function insertAdminChangeHistoryTx(
  client,
  {
    adminId,
    userId,
    action,
    reason,
    oldValues = null,
    newValues = null,
    inlineAction = false,
  },
) {
  const serializedOld = oldValues === null ? null : JSON.stringify(oldValues);
  const serializedNew = newValues === null ? null : JSON.stringify(newValues);

  if (inlineAction) {
    if (!/^[A-Z0-9_]+$/.test(action)) {
      throw new Error(`Invalid inline audit action: ${action}`);
    }
    const { rows } = await client.query(
      `INSERT INTO admin_user_change_history
        (admin_id, user_id, action, reason, old_values, new_values, created_at)
       VALUES ($1, $2, '${action}', $3, $4, $5, NOW())
       RETURNING id, action, reason, created_at`,
      [adminId, userId, reason, serializedOld, serializedNew],
    );
    return rows[0];
  }

  const { rows } = await client.query(
    `INSERT INTO admin_user_change_history
      (admin_id, user_id, action, reason, old_values, new_values, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
     RETURNING id, action, reason, created_at`,
    [adminId, userId, action, reason, serializedOld, serializedNew],
  );
  return rows[0];
}

async function recordAdminHistoryAndOutboxTx(
  client,
  {
    adminId,
    userId,
    action,
    reason,
    oldValues = null,
    newValues = null,
    outboxEventType = action,
    extraOutbox = {},
  },
) {
  const historyRow = await insertAdminChangeHistoryTx(client, {
    adminId,
    userId,
    action,
    reason,
    oldValues,
    newValues,
  });

  await recordAudit(client, {
    eventType: outboxEventType,
    payload: {
      audit_id: historyRow.id,
      admin_id: adminId,
      user_id: userId,
      action,
      reason,
      old_values: oldValues,
      new_values: newValues,
      ...extraOutbox,
    },
  });

  return historyRow;
}

module.exports = {
  insertAdminChangeHistoryTx,
  recordAdminHistoryAndOutboxTx,
};
