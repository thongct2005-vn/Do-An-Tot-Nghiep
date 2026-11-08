const pool = require("../../config/database");
const { uuidv7 } = require("uuidv7");

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
            (t.transaction_type IN ('TRANSFER', 'PAYMENT') 
             AND t.source_balance_before IS NOT NULL 
             AND t.source_balance_after IS NOT NULL 
             AND t.dest_balance_before IS NOT NULL 
             AND t.dest_balance_after IS NOT NULL 
             AND ((t.source_balance_before - t.amount - COALESCE(t.fee, 0) != t.source_balance_after) 
                  OR (t.dest_balance_before + t.amount != t.dest_balance_after)))
            OR
            (t.transaction_type = 'TOPUP' 
             AND t.source_balance_before IS NOT NULL 
             AND t.source_balance_after IS NOT NULL 
             AND (t.source_balance_before + t.amount != t.source_balance_after))
            OR
            (t.transaction_type = 'WITHDRAW' 
             AND t.source_balance_before IS NOT NULL 
             AND t.source_balance_after IS NOT NULL 
             AND (t.source_balance_before - t.amount - COALESCE(t.fee, 0) != t.source_balance_after))
          )
        )`);
        break;

      case "MISSING_SNAPSHOT":
        conditions.push(`(
          t.status = 'SUCCESS' AND (
            t.source_balance_before IS NULL 
            OR t.source_balance_after IS NULL 
            OR (t.transaction_type IN ('TRANSFER', 'PAYMENT') AND (t.dest_balance_before IS NULL OR t.dest_balance_after IS NULL))
          )
        )`);
        break;

      case "STUCK_PENDING":
        conditions.push(`(t.status = 'PENDING' AND t.created_at < (NOW() - INTERVAL '15 minutes'))`);
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
    anomaly,
    keyword,
    startDate,
    endDate,
  }) {
    const { whereClause, params } = buildFilterConditions({
      type,
      status,
      initiatedBy,
      anomaly,
      keyword,
      startDate,
      endDate,
    });

    const query = `
      SELECT COUNT(*)::INT AS total
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN (
        SELECT DISTINCT ON (ach.new_values->>'transaction_id')
          ach.id,
          ach.new_values->>'transaction_id' AS transaction_id
        FROM admin_user_change_history ach
        WHERE ach.new_values->>'transaction_id' IS NOT NULL
          AND ach.action IN ('ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW')
        ORDER BY (ach.new_values->>'transaction_id'), ach.created_at DESC, ach.id DESC
      ) ach ON ach.transaction_id = t.id::TEXT
      WHERE ${whereClause}
    `;

    const result = await pool.query(query, params);
    return result.rows[0]?.total || 0;
  },

  async getTransactions({
    type,
    status,
    initiatedBy,
    anomaly,
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
      anomaly,
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
          WHEN t.source_user_id IS NOT NULL THEN 'USER'
          ELSE 'SYSTEM' 
        END AS initiator_role,
        au.id AS admin_id,
        au.full_name AS admin_name
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN (
        SELECT DISTINCT ON (ach.new_values->>'transaction_id')
          ach.id,
          ach.new_values->>'transaction_id' AS transaction_id,
          ach.admin_id
        FROM admin_user_change_history ach
        WHERE ach.new_values->>'transaction_id' IS NOT NULL
          AND ach.action IN ('ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW')
        ORDER BY (ach.new_values->>'transaction_id'), ach.created_at DESC, ach.id DESC
      ) ach ON ach.transaction_id = t.id::TEXT
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
        ach.admin_auth_ref,
        ach.admin_execution_mode,
        au.id AS admin_id,
        au.full_name AS admin_name,
        au.email AS admin_email
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      LEFT JOIN (
        SELECT DISTINCT ON (ach.new_values->>'transaction_id')
          ach.id,
          ach.new_values->>'transaction_id' AS transaction_id,
          ach.action,
          ach.admin_id,
          ach.reason,
          ach.created_at,
          ach.new_values->>'authorization_reference' AS admin_auth_ref,
          ach.new_values->>'execution_mode' AS admin_execution_mode
        FROM admin_user_change_history ach
        WHERE ach.new_values->>'transaction_id' IS NOT NULL
          AND ach.action IN ('ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW')
        ORDER BY (ach.new_values->>'transaction_id'), ach.created_at DESC, ach.id DESC
      ) ach ON ach.transaction_id = t.id::TEXT
      LEFT JOIN users au ON ach.admin_id = au.id
      WHERE t.id = $1
      LIMIT 1
    `;

    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  async getTransactionsForExport({
    type,
    status,
    initiatedBy,
    anomaly,
    keyword,
    startDate,
    endDate,
    limit = 5001,
  }) {
    const { whereClause, params } = buildFilterConditions({
      type,
      status,
      initiatedBy,
      anomaly,
      keyword,
      startDate,
      endDate,
    });

    const queryParams = [...params];
    queryParams.push(limit);
    const limitIdx = queryParams.length;

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
        t.source_balance_before,
        t.source_balance_after,
        t.destination_user_id,
        du.full_name AS destination_user_name,
        du.phone AS destination_user_phone,
        t.dest_balance_before,
        t.dest_balance_after,
        t.linked_bank_account_id,
        lba.account_number AS bank_account_number,
        b.name AS bank_name,
        pr.reference_code,
        pr.order_id,
        CASE 
          WHEN ach.id IS NOT NULL THEN 'ADMIN' 
          WHEN t.source_user_id IS NOT NULL THEN 'USER'
          ELSE 'SYSTEM' 
        END AS initiator_role,
        au.id AS admin_id,
        au.full_name AS admin_name,
        ach.action AS admin_action,
        ach.reason AS admin_reason,
        ach.admin_auth_ref
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      LEFT JOIN (
        SELECT DISTINCT ON (ach.new_values->>'transaction_id')
          ach.id,
          ach.new_values->>'transaction_id' AS transaction_id,
          ach.action,
          ach.admin_id,
          ach.reason,
          ach.created_at,
          ach.new_values->>'authorization_reference' AS admin_auth_ref
        FROM admin_user_change_history ach
        WHERE ach.new_values->>'transaction_id' IS NOT NULL
          AND ach.action IN ('ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW')
        ORDER BY (ach.new_values->>'transaction_id'), ach.created_at DESC, ach.id DESC
      ) ach ON ach.transaction_id = t.id::TEXT
      LEFT JOIN users au ON ach.admin_id = au.id
      WHERE ${whereClause}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${limitIdx}
    `;

    const result = await pool.query(query, queryParams);
    return result.rows;
  },

  async getUserById(id) {
    if (!id) return null;
    const query = `
      SELECT id, full_name, email, phone, role
      FROM users
      WHERE id = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  async getTransactionTimeline(id) {
    const events = [];

    // 1. Từ payment_requests
    const prRes = await pool.query(
      `SELECT id, reference_code, order_id, amount, status, created_at, paid_at
       FROM payment_requests
       WHERE transaction_id = $1`,
      [id]
    );
    for (const pr of prRes.rows) {
      if (pr.created_at) {
        events.push({
          id: `PR_CREATED_${pr.id}`,
          timestamp: pr.created_at,
          source: "payment_requests",
          event_type: "PAYMENT_REQUEST_CREATED",
          title: "Tạo yêu cầu thanh toán QR",
          description: `Đơn hàng: ${pr.order_id || "N/A"} - Mã tham chiếu: ${pr.reference_code || "N/A"}`,
          data: { order_id: pr.order_id, reference_code: pr.reference_code, status: pr.status },
        });
      }
      if (pr.paid_at) {
        events.push({
          id: `PR_PAID_${pr.id}`,
          timestamp: pr.paid_at,
          source: "payment_requests",
          event_type: "PAYMENT_REQUEST_PAID",
          title: "Ghi nhận thanh toán yêu cầu QR",
          description: `Khách hàng hoàn tất thanh toán cho đơn hàng ${pr.order_id || pr.reference_code || ""}`.trim(),
          data: { paid_at: pr.paid_at },
        });
      }

      // Webhook deliveries nếu có
      const wdRes = await pool.query(
        `SELECT id, event_type, status, attempt_count, last_http_status, created_at, delivered_at
         FROM webhook_deliveries
         WHERE payment_request_id = $1`,
        [pr.id]
      );
      for (const wd of wdRes.rows) {
        events.push({
          id: `WD_${wd.id}`,
          timestamp: wd.delivered_at || wd.created_at,
          source: "webhook_deliveries",
          event_type: "WEBHOOK_DELIVERY",
          title: `Gửi Webhook thông báo kết quả (${wd.status})`,
          description: `Sự kiện: ${wd.event_type} - HTTP Status: ${wd.last_http_status || "N/A"} - Lần thử: ${wd.attempt_count}`,
          data: { status: wd.status, http_status: wd.last_http_status, attempt_count: wd.attempt_count },
        });
      }
    }

    // 2. Từ transactions
    const txRes = await pool.query(
      `SELECT id, transaction_type, status, created_at, completed_at
       FROM transactions
       WHERE id = $1`,
      [id]
    );
    const tx = txRes.rows[0];
    if (tx) {
      events.push({
        id: `TX_CREATED_${tx.id}`,
        timestamp: tx.created_at,
        source: "transactions",
        event_type: "TRANSACTION_CREATED",
        title: `Ghi nhận bút toán giao dịch (${tx.status})`,
        description: `Bản ghi giao dịch loại ${tx.transaction_type} được tạo với trạng thái ${tx.status}`,
        data: { status: tx.status, type: tx.transaction_type },
      });
      if (tx.completed_at) {
        events.push({
          id: `TX_COMPLETED_${tx.id}`,
          timestamp: tx.completed_at,
          source: "transactions",
          event_type: "TRANSACTION_COMPLETED",
          title: "Hoàn tất xử lý giao dịch",
          description: `Giao dịch chính thức chuyển sang trạng thái hoàn tất tại mốc thời gian này`,
          data: { completed_at: tx.completed_at },
        });
      }
    }

    // 3. Từ audit_outbox
    const aoRes = await pool.query(
      `SELECT id, event_type, payload, created_at
       FROM audit_outbox
       WHERE (payload->>'transaction_id') = $1::TEXT`,
      [id]
    );
    for (const ao of aoRes.rows) {
      events.push({
        id: `AO_${ao.id}`,
        timestamp: ao.created_at,
        source: "audit_outbox",
        event_type: ao.event_type || "AUDIT_EVENT",
        title: `Hệ thống ghi nhận sự kiện (${ao.event_type})`,
        description: `Sự kiện kiểm toán tự động được ghi nhận vào audit outbox`,
        data: ao.payload,
      });
    }

    // 4. Từ admin_user_change_history
    const achRes = await pool.query(
      `SELECT ach.id, ach.action, ach.reason, ach.new_values, ach.created_at,
              u.full_name AS admin_name, u.email AS admin_email
       FROM admin_user_change_history ach
       LEFT JOIN users u ON ach.admin_id = u.id
       WHERE (ach.new_values->>'transaction_id') = $1::TEXT
       ORDER BY ach.created_at ASC`,
      [id]
    );
    for (const ach of achRes.rows) {
      let title = `Quản trị viên thao tác (${ach.action})`;
      if (ach.action === "DISPUTE_OPENED") {
        title = `Mở hồ sơ tra soát (#${ach.new_values?.authorization_reference || ach.new_values?.dispute_id?.slice(0, 8)})`;
      } else if (ach.action === "DISPUTE_UPDATED") {
        title = `Cập nhật hồ sơ tra soát (${ach.new_values?.dispute_status || ""})`;
      } else if (ach.action === "DISPUTE_RESOLVED") {
        title = `Kết luận và đóng hồ sơ tra soát (${ach.new_values?.resolution_result || "RESOLVED"})`;
      }

      events.push({
        id: `ACH_${ach.id}`,
        timestamp: ach.created_at,
        source: "admin_user_change_history",
        event_type: ach.action,
        title,
        description: `Admin: ${ach.admin_name || "Quản trị viên"} - Lý do: ${ach.reason || "N/A"}${ach.new_values?.note ? ` - Ghi chú: ${ach.new_values.note}` : ""}`,
        data: {
          admin_name: ach.admin_name,
          admin_email: ach.admin_email,
          action: ach.action,
          reason: ach.reason,
          new_values: ach.new_values,
        },
      });
    }

    // Sắp xếp theo timestamp ASC, id ASC
    events.sort((a, b) => {
      const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });

    return events;
  },

  async lockTransactionForDispute(client, transactionId) {
    const query = `
      SELECT id, transaction_type, amount, fee, status, source_user_id, destination_user_id
      FROM transactions
      WHERE id = $1
      FOR UPDATE
    `;
    const result = await client.query(query, [transactionId]);
    return result.rows[0] || null;
  },

  async getDisputeEventsByTransactionId(transactionId, client = pool) {
    const query = `
      SELECT 
        ach.id,
        ach.admin_id,
        ach.user_id,
        ach.action,
        ach.reason,
        ach.old_values,
        ach.new_values,
        ach.created_at,
        au.full_name AS admin_name,
        au.email AS admin_email
      FROM admin_user_change_history ach
      LEFT JOIN users au ON ach.admin_id = au.id
      WHERE (ach.new_values->>'transaction_id') = $1::TEXT
        AND ach.action IN ('DISPUTE_OPENED', 'DISPUTE_UPDATED', 'DISPUTE_RESOLVED')
      ORDER BY ach.created_at ASC, ach.id ASC
    `;
    const result = await client.query(query, [transactionId]);
    return result.rows;
  },

  async insertDisputeEvent(client, {
    adminId,
    userId,
    action,
    reason,
    oldValues,
    newValues,
  }) {
    const id = uuidv7();
    const query = `
      INSERT INTO admin_user_change_history (
        id, admin_id, user_id, action, reason, old_values, new_values, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id, admin_id, user_id, action, reason, old_values, new_values, created_at
    `;
    const result = await client.query(query, [
      id,
      adminId,
      userId,
      action,
      reason,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
    ]);
    return result.rows[0];
  },

  async getClient() {
    return pool.connect();
  },
};

module.exports = adminTransactionRepository;

