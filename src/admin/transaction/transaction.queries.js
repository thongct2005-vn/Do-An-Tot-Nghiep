// transaction.queries.js: Biểu thức SQL lọc giao dịch, dựng truy vấn đếm trực tiếp và phân giải tranh chấp cho Admin.

const ADMIN_FINANCIAL_ACTIONS_SQL =
  "'ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW', 'ADMIN_OP_REVERSAL'";

const ADMIN_TX_AUDIT_MAP_SQL = `
  SELECT DISTINCT ON (tx_id)
    id,
    tx_id AS transaction_id,
    action,
    admin_id,
    reason,
    created_at,
    admin_auth_ref,
    admin_execution_mode,
    admin_original_transaction_id,
    admin_dispute_id
  FROM (
    SELECT
      ach.id,
      ach.new_values->>'transaction_id' AS tx_id,
      ach.action,
      ach.admin_id,
      ach.reason,
      ach.created_at,
      ach.new_values->>'authorization_reference' AS admin_auth_ref,
      ach.new_values->>'execution_mode' AS admin_execution_mode,
      ach.new_values->>'original_transaction_id' AS admin_original_transaction_id,
      ach.new_values->>'dispute_id' AS admin_dispute_id
    FROM admin_user_change_history ach
    WHERE ach.new_values->>'transaction_id' IS NOT NULL
      AND ach.action IN (${ADMIN_FINANCIAL_ACTIONS_SQL})
    UNION ALL
    SELECT
      ach.id,
      ach.new_values->>'excess_transaction_id' AS tx_id,
      ach.action,
      ach.admin_id,
      ach.reason,
      ach.created_at,
      ach.new_values->>'authorization_reference' AS admin_auth_ref,
      ach.new_values->>'execution_mode' AS admin_execution_mode,
      ach.new_values->>'original_transaction_id' AS admin_original_transaction_id,
      ach.new_values->>'dispute_id' AS admin_dispute_id
    FROM admin_user_change_history ach
    WHERE ach.action = 'ADMIN_OP_REVERSAL'
      AND ach.new_values->>'excess_transaction_id' IS NOT NULL
  ) mapped
  ORDER BY tx_id, created_at DESC, id DESC
`;

function resolveActiveDisputeIdFromEvents(disputeEvents) {
  const disputeStatusMap = {};
  for (const ev of disputeEvents || []) {
    const dId = ev.new_values?.dispute_id || String(ev.id);
    const st =
      ev.new_values?.dispute_status ||
      (ev.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN");
    disputeStatusMap[dId] = st;
  }
  const activeEntry = Object.entries(disputeStatusMap).find(
    ([, st]) => st === "OPEN" || st === "INVESTIGATING",
  );
  return activeEntry ? activeEntry[0] : null;
}

function hasNonEmpty(value) {
  return Boolean(value && String(value).trim() !== "");
}

function buildFilterConditions({
  type,
  status,
  initiatedBy,
  anomaly,
  keyword,
  startDate,
  endDate,
}) {
  const conditions = [];
  const params = [];

  if (type && type !== "ALL") {
    params.push(type);
    conditions.push(`t.transaction_type = $${params.length}`);
  }

  if (status && status !== "ALL") {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }

  if (initiatedBy === "ADMIN") {
    conditions.push(`ach.id IS NOT NULL`);
  } else if (initiatedBy === "USER") {
    conditions.push(`ach.id IS NULL AND t.source_user_id IS NOT NULL`);
  } else if (initiatedBy === "SYSTEM") {
    conditions.push(`ach.id IS NULL AND t.source_user_id IS NULL`);
  }

  if (anomaly && anomaly !== "ALL") {
    switch (anomaly) {
      case "BALANCE_MISMATCH":
        conditions.push(`(
          t.status = 'SUCCESS' AND (
            (t.transaction_type IN ('TRANSFER', 'PAYMENT', 'REFUND')
             AND t.destination_user_id IS NOT NULL
             AND t.source_balance_before IS NOT NULL 
             AND t.source_balance_after IS NOT NULL 
             AND t.dest_balance_before IS NOT NULL 
             AND t.dest_balance_after IS NOT NULL 
             AND (
               (t.linked_bank_account_id IS NOT NULL AND t.source_balance_before != t.source_balance_after)
               OR (t.linked_bank_account_id IS NULL AND (t.source_balance_before - t.amount - COALESCE(t.user_fee, 0) != t.source_balance_after))
               OR (t.dest_balance_before + t.amount - COALESCE(t.merchant_fee, 0) != t.dest_balance_after)
             ))
            OR
            (t.transaction_type = 'PAYMENT'
             AND t.destination_user_id IS NULL
             AND t.source_balance_before IS NOT NULL
             AND t.source_balance_after IS NOT NULL
             AND (
               (t.linked_bank_account_id IS NOT NULL AND t.source_balance_before != t.source_balance_after)
               OR (t.linked_bank_account_id IS NULL AND (t.source_balance_before - t.amount - COALESCE(t.user_fee, 0) != t.source_balance_after))
             ))
            OR
            (t.transaction_type = 'TOPUP' 
             AND t.source_balance_before IS NOT NULL 
             AND t.source_balance_after IS NOT NULL 
             AND (t.source_balance_before + t.amount != t.source_balance_after))
            OR
            (t.transaction_type = 'WITHDRAW' 
             AND t.source_balance_before IS NOT NULL 
             AND t.source_balance_after IS NOT NULL 
             AND (t.source_balance_before - t.amount - COALESCE(t.user_fee, 0) != t.source_balance_after))
          )
        )`);
        break;

      case "MISSING_SNAPSHOT":
        conditions.push(`(
          t.status = 'SUCCESS' AND (
            t.source_balance_before IS NULL 
            OR t.source_balance_after IS NULL 
            OR (t.transaction_type IN ('TRANSFER', 'PAYMENT', 'REFUND') AND t.destination_user_id IS NOT NULL AND (t.dest_balance_before IS NULL OR t.dest_balance_after IS NULL))
          )
        )`);
        break;

      case "STUCK_PENDING":
        conditions.push(
          `(t.status = 'PENDING' AND t.created_at < (NOW() - INTERVAL '15 minutes'))`,
        );
        break;

      case "HIGH_VALUE_TX":
        conditions.push(`(t.amount >= 10000000)`);
        break;

      case "ACTIVE_DISPUTE":
        conditions.push(`EXISTS (
          SELECT 1 
          FROM admin_user_change_history d_ach 
          WHERE (d_ach.new_values->>'transaction_id') = t.id::TEXT 
            AND (d_ach.new_values->>'dispute_status') IN ('OPEN', 'INVESTIGATING')
        )`);
        break;
    }
  }

  if (startDate) {
    params.push(startDate);
    conditions.push(`t.created_at >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    conditions.push(`t.created_at < $${params.length}`);
  }

  if (keyword && keyword.trim() !== "") {
    params.push(`%${keyword.trim()}%`);
    const kwIdx = params.length;
    conditions.push(
      `(t.id::TEXT LIKE $${kwIdx} 
        OR su.full_name ILIKE $${kwIdx} 
        OR du.full_name ILIKE $${kwIdx} 
        OR su.phone LIKE $${kwIdx} 
        OR du.phone LIKE $${kwIdx} 
        OR t.description ILIKE $${kwIdx})`,
    );
  }

  const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "1=1";
  return { whereClause, params };
}

function buildDirectCountQuery(filters) {
  const { initiatedBy, keyword } = filters;
  const needUsers = hasNonEmpty(keyword);
  const needAudit = Boolean(initiatedBy && initiatedBy !== "ALL");
  const { whereClause, params } = buildFilterConditions(filters);

  const joins = [];
  if (needUsers) {
    joins.push("LEFT JOIN users su ON t.source_user_id = su.id");
    joins.push("LEFT JOIN users du ON t.destination_user_id = du.id");
  }
  if (needAudit) {
    joins.push(
      `LEFT JOIN (${ADMIN_TX_AUDIT_MAP_SQL}) ach ON ach.transaction_id = t.id::TEXT`,
    );
  }

  return {
    query: `
      SELECT COUNT(*)::INT AS total
      FROM transactions t
      ${joins.join("\n      ")}
      WHERE ${whereClause}
    `,
    params,
  };
}

function canUseRollupCount({
  initiatedBy,
  anomaly,
  keyword,
  startDate,
  endDate,
}) {
  return (
    !hasNonEmpty(keyword) &&
    (!initiatedBy || initiatedBy === "ALL") &&
    (!anomaly || anomaly === "ALL") &&
    Boolean(startDate) &&
    Boolean(endDate)
  );
}

module.exports = {
  ADMIN_FINANCIAL_ACTIONS_SQL,
  ADMIN_TX_AUDIT_MAP_SQL,
  resolveActiveDisputeIdFromEvents,
  hasNonEmpty,
  buildFilterConditions,
  buildDirectCountQuery,
  canUseRollupCount,
};

