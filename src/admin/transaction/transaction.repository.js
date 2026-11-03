const pool = require("../../config/database");

function buildFilterConditions({
  type,
  status,
  initiatedBy,
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
    conditions.push(`ach.id IS NULL`);
  }

  if (startDate) {
    params.push(startDate);
    conditions.push(`t.created_at >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    conditions.push(`t.created_at <= $${params.length}`);
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
        OR t.description ILIKE $${kwIdx})`
    );
  }

  const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "1=1";
  return { whereClause, params };
}

const adminTransactionRepository = {
  async countTransactions({
    type,
    status,
    initiatedBy,
    keyword,
    startDate,
    endDate,
  }) {
    const { whereClause, params } = buildFilterConditions({
      type,
      status,
      initiatedBy,
      keyword,
      startDate,
      endDate,
    });

    const query = `
      SELECT COUNT(*)::INT AS total
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN admin_user_change_history ach 
        ON (ach.new_values->>'transaction_id') = t.id::TEXT
        AND ach.action IN ('ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW')
      WHERE ${whereClause}
    `;

    const result = await pool.query(query, params);
    return result.rows[0]?.total || 0;
  },

  async getTransactions({
    type,
    status,
    initiatedBy,
    keyword,
    startDate,
    endDate,
    limit = 20,
    offset = 0,
  }) {
    const { whereClause, params } = buildFilterConditions({
      type,
      status,
      initiatedBy,
      keyword,
      startDate,
      endDate,
    });

    const queryParams = [...params];
    queryParams.push(limit);
    const limitIdx = queryParams.length;
    queryParams.push(offset);
    const offsetIdx = queryParams.length;

    const query = `
      SELECT 
        t.id,
        t.transaction_type,
        t.amount,
        t.fee,
        t.status,
        t.description,
        t.created_at,
        t.source_user_id,
        su.full_name AS source_user_name,
        su.phone AS source_user_phone,
        t.destination_user_id,
        du.full_name AS destination_user_name,
        du.phone AS destination_user_phone,
        CASE 
          WHEN ach.id IS NOT NULL THEN 'ADMIN' 
          ELSE 'USER' 
        END AS initiator_role,
        au.id AS admin_id,
        au.full_name AS admin_name
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN admin_user_change_history ach 
        ON (ach.new_values->>'transaction_id') = t.id::TEXT
        AND ach.action IN ('ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW')
      LEFT JOIN users au ON ach.admin_id = au.id
      WHERE ${whereClause}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const result = await pool.query(query, queryParams);
    return result.rows;
  },

  async getTransactionDetailById(id) {
    const query = `
      SELECT 
        t.id,
        t.transaction_type,
        t.amount,
        t.fee,
        t.status,
        t.description,
        t.idempotency_key,
        t.created_at,
        t.source_user_id,
        su.full_name AS source_user_name,
        su.phone AS source_user_phone,
        su.email AS source_user_email,
        t.source_balance_before,
        t.source_balance_after,
        t.destination_user_id,
        du.full_name AS destination_user_name,
        du.phone AS destination_user_phone,
        du.email AS destination_user_email,
        t.dest_balance_before,
        t.dest_balance_after,
        t.linked_bank_account_id,
        lba.account_number AS bank_account_number,
        b.name AS bank_name,
        b.code AS bank_code,
        b.logo_url AS bank_logo_url,
        pr.reference_code,
        pr.order_id,
        ach.id AS audit_history_id,
        ach.action AS admin_action,
        ach.reason AS admin_reason,
        ach.created_at AS admin_executed_at,
        ach.new_values->>'authorization_reference' AS admin_auth_ref,
        ach.new_values->>'execution_mode' AS admin_execution_mode,
        au.id AS admin_id,
        au.full_name AS admin_name,
        au.email AS admin_email
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      LEFT JOIN admin_user_change_history ach 
        ON (ach.new_values->>'transaction_id') = t.id::TEXT
        AND ach.action IN ('ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW')
      LEFT JOIN users au ON ach.admin_id = au.id
      WHERE t.id = $1
      LIMIT 1
    `;

    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },
};

module.exports = adminTransactionRepository;

