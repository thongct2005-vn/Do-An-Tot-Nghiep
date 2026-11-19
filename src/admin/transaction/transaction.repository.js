const pool = require("../../config/database");
const { uuidv7 } = require("uuidv7");
const {
  ensureRollupConsistent,
  computeHybridWindow,
} = require("../dashboard/dashboardRollup");
const TransactionRepository = require("../../modules/transaction/transaction.repository");
const { httpError } = require("../../utils/httpError");
const { maskPhone } = require("../../utils/mask");

const ADMIN_FINANCIAL_ACTIONS_SQL =
  "'ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW', 'ADMIN_OP_REVERSAL'";

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
    ([, st]) => st === "OPEN" || st === "INVESTIGATING"
  );
  return activeEntry ? activeEntry[0] : null;
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
            (t.transaction_type IN ('TRANSFER', 'PAYMENT')
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
            OR (t.transaction_type IN ('TRANSFER', 'PAYMENT') AND t.destination_user_id IS NOT NULL AND (t.dest_balance_before IS NULL OR t.dest_balance_after IS NULL))
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
        OR t.description ILIKE $${kwIdx})`
    );
  }

  const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "1=1";
  return { whereClause, params };
}

function hasNonEmpty(value) {
  return Boolean(value && String(value).trim() !== "");
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
    joins.push(`LEFT JOIN (
        SELECT DISTINCT ON (ach.new_values->>'transaction_id')
          ach.id,
          ach.new_values->>'transaction_id' AS transaction_id
        FROM admin_user_change_history ach
        WHERE ach.new_values->>'transaction_id' IS NOT NULL
          AND ach.action IN (${ADMIN_FINANCIAL_ACTIONS_SQL})
        ORDER BY (ach.new_values->>'transaction_id'), ach.created_at DESC, ach.id DESC
      ) ach ON ach.transaction_id = t.id::TEXT`);
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

function canUseRollupCount({ initiatedBy, anomaly, keyword, startDate, endDate }) {
  return (
    !hasNonEmpty(keyword) &&
    (!initiatedBy || initiatedBy === "ALL") &&
    (!anomaly || anomaly === "ALL") &&
    Boolean(startDate) &&
    Boolean(endDate)
  );
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
    const filters = {
      type,
      status,
      initiatedBy,
      anomaly,
      keyword,
      startDate,
      endDate,
    };

    if (canUseRollupCount(filters)) {
      const rollupUntil = await ensureRollupConsistent(pool);
      if (rollupUntil) {
        const { useRollup, useTail, splitInstant } = computeHybridWindow(
          startDate,
          endDate,
          rollupUntil,
        );
        const branches = [];
        const params = [];

        if (useRollup) {
          const sIdx = `$${params.push(startDate)}`;
          const eIdx = `$${params.push(splitInstant)}`;
          const conds = [`bucket_hour >= ${sIdx}`, `bucket_hour < ${eIdx}`];
          if (type && type !== "ALL") {
            conds.push(`transaction_type = $${params.push(type)}`);
          }
          if (status && status !== "ALL") {
            conds.push(`status = $${params.push(status)}`);
          }
          branches.push(`
            SELECT COALESCE(SUM(tx_count), 0)::bigint AS cnt
            FROM public.dashboard_tx_hourly
            WHERE ${conds.join(" AND ")}
          `);
        }

        if (useTail) {
          const sIdx = `$${params.push(splitInstant)}`;
          const eIdx = `$${params.push(endDate)}`;
          const conds = [`t.created_at >= ${sIdx}`, `t.created_at < ${eIdx}`];
          if (type && type !== "ALL") {
            conds.push(`t.transaction_type = $${params.push(type)}`);
          }
          if (status && status !== "ALL") {
            conds.push(`t.status = $${params.push(status)}`);
          }
          branches.push(`
            SELECT COUNT(*)::bigint AS cnt
            FROM public.transactions t
            WHERE ${conds.join(" AND ")}
          `);
        }

        if (branches.length === 0) return 0;

        try {
          const result = await pool.query(
            `SELECT COALESCE(SUM(cnt), 0)::INT AS total FROM (${branches.join(" UNION ALL ")}) c`,
            params,
          );
          return result.rows[0]?.total || 0;
        } catch (err) {
          if (!err || err.code !== "42P01") {
            throw err;
          }
        }
      }
    }

    const { query, params } = buildDirectCountQuery(filters);
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
    const needUsersInFilter = hasNonEmpty(keyword);
    const needAuditInFilter = Boolean(initiatedBy && initiatedBy !== "ALL");
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

    const filterJoins = [];
    if (needUsersInFilter) {
      filterJoins.push("LEFT JOIN users su ON t.source_user_id = su.id");
      filterJoins.push("LEFT JOIN users du ON t.destination_user_id = du.id");
    }
    if (needAuditInFilter) {
      filterJoins.push(`LEFT JOIN (
        SELECT DISTINCT ON (ach.new_values->>'transaction_id')
          ach.id,
          ach.new_values->>'transaction_id' AS transaction_id
        FROM admin_user_change_history ach
        WHERE ach.new_values->>'transaction_id' IS NOT NULL
          AND ach.action IN (${ADMIN_FINANCIAL_ACTIONS_SQL})
        ORDER BY (ach.new_values->>'transaction_id'), ach.created_at DESC, ach.id DESC
      ) ach ON ach.transaction_id = t.id::TEXT`);
    }

    const query = `
      WITH paged_tx AS (
        SELECT
          t.id,
          t.transaction_type,
          t.amount,
          t.user_fee AS fee,
          t.merchant_fee,
          t.fee_rate_snapshot,
          t.status,
          t.description,
          t.created_at,
          t.source_user_id,
          t.destination_user_id
        FROM transactions t
        ${filterJoins.join("\n        ")}
        WHERE ${whereClause}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      ),
      paged_audit AS (
        SELECT DISTINCT ON (ach.new_values->>'transaction_id')
          ach.id,
          ach.new_values->>'transaction_id' AS transaction_id,
          ach.action,
          ach.admin_id
        FROM admin_user_change_history ach
        WHERE (ach.new_values->>'transaction_id') IN (SELECT p.id::TEXT FROM paged_tx p)
          AND (ach.new_values->>'transaction_id') IS NOT NULL
          AND ach.action IN (${ADMIN_FINANCIAL_ACTIONS_SQL})
        ORDER BY (ach.new_values->>'transaction_id'), ach.created_at DESC, ach.id DESC
      )
      SELECT
        p.id,
        p.transaction_type,
        p.amount,
        p.fee,
        p.merchant_fee,
        p.fee_rate_snapshot,
        p.status,
        p.description,
        p.created_at,
        p.source_user_id,
        su.full_name AS source_user_name,
        su.phone AS source_user_phone,
        p.destination_user_id,
        du.full_name AS destination_user_name,
        du.phone AS destination_user_phone,
        CASE
          WHEN pa.id IS NOT NULL THEN 'ADMIN'
          WHEN p.source_user_id IS NOT NULL THEN 'USER'
          ELSE 'SYSTEM'
        END AS initiator_role,
        pa.action AS admin_action,
        au.id AS admin_id,
        au.full_name AS admin_name
      FROM paged_tx p
      LEFT JOIN users su ON p.source_user_id = su.id
      LEFT JOIN users du ON p.destination_user_id = du.id
      LEFT JOIN paged_audit pa ON pa.transaction_id = p.id::TEXT
      LEFT JOIN users au ON pa.admin_id = au.id
      ORDER BY p.created_at DESC, p.id DESC
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
        t.user_fee AS fee,
        t.merchant_fee,
        t.fee_rate_snapshot,
        t.status,
        t.description,
        t.idempotency_key,
        t.created_at,
        t.source_user_id,
        su.full_name AS source_user_name,
        su.phone AS source_user_phone,
        su.email AS source_user_email,
        su.role AS source_user_role,
        su.status AS source_user_status,
        t.source_balance_before,
        t.source_balance_after,
        t.destination_user_id,
        du.full_name AS destination_user_name,
        du.phone AS destination_user_phone,
        du.email AS destination_user_email,
        du.role AS destination_user_role,
        du.status AS destination_user_status,
        du.balance AS destination_user_balance,
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
        ach.admin_original_transaction_id,
        ach.admin_dispute_id,
        au.id AS admin_id,
        au.full_name AS admin_name,
        au.email AS admin_email,
        rev.reversal_audit_id,
        rev.reversal_tx_id,
        rev.reversal_dispute_id,
        rev.reversal_reason,
        rev.reversed_at,
        rev.reversal_admin_id,
        rev.reversal_admin_name,
        rev.reversal_admin_email
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
          ach.new_values->>'execution_mode' AS admin_execution_mode,
          ach.new_values->>'original_transaction_id' AS admin_original_transaction_id,
          ach.new_values->>'dispute_id' AS admin_dispute_id
        FROM admin_user_change_history ach
        WHERE ach.new_values->>'transaction_id' IS NOT NULL
          AND ach.action IN (${ADMIN_FINANCIAL_ACTIONS_SQL})
        ORDER BY (ach.new_values->>'transaction_id'), ach.created_at DESC, ach.id DESC
      ) ach ON ach.transaction_id = t.id::TEXT
      LEFT JOIN users au ON ach.admin_id = au.id
      LEFT JOIN (
        SELECT DISTINCT ON (r.new_values->>'original_transaction_id')
          r.id AS reversal_audit_id,
          r.new_values->>'transaction_id' AS reversal_tx_id,
          r.new_values->>'original_transaction_id' AS original_tx_id,
          r.new_values->>'dispute_id' AS reversal_dispute_id,
          r.reason AS reversal_reason,
          r.created_at AS reversed_at,
          ru.id AS reversal_admin_id,
          ru.full_name AS reversal_admin_name,
          ru.email AS reversal_admin_email
        FROM admin_user_change_history r
        LEFT JOIN users ru ON r.admin_id = ru.id
        WHERE r.action = 'ADMIN_OP_REVERSAL'
          AND (r.new_values->>'original_transaction_id') IS NOT NULL
        ORDER BY (r.new_values->>'original_transaction_id'), r.created_at DESC, r.id DESC
      ) rev ON rev.original_tx_id = t.id::TEXT
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
        t.user_fee AS fee,
        t.merchant_fee,
        t.fee_rate_snapshot,
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
        ach.admin_auth_ref,
        ach.admin_original_transaction_id
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
          ach.new_values->>'original_transaction_id' AS admin_original_transaction_id
        FROM admin_user_change_history ach
        WHERE ach.new_values->>'transaction_id' IS NOT NULL
          AND ach.action IN (${ADMIN_FINANCIAL_ACTIONS_SQL})
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
          OR (ach.action = 'ADMIN_OP_REVERSAL' AND (ach.new_values->>'original_transaction_id') = $1::TEXT)
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
      } else if (ach.action === "ADMIN_OP_REVERSAL") {
        if (String(ach.new_values?.original_transaction_id) === String(id)) {
          title = `Giao dịch đã được hoàn tiền toàn bộ (tạo bù trừ ${ach.new_values?.transaction_id || ""})`;
        } else {
          title = `Thực thi giao dịch hoàn tiền P2P (giao dịch gốc ${ach.new_values?.original_transaction_id || ""})`;
        }
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
      SELECT id, transaction_type, amount, user_fee AS fee, status, source_user_id, destination_user_id
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

  resolveActiveDisputeIdFromEvents,

  async insertReversalAuditHistory(
    client,
    { adminId, userId, reason, oldValues, newValues }
  ) {
    const id = uuidv7();
    const result = await client.query(
      `
      INSERT INTO admin_user_change_history (
        id, admin_id, user_id, action, reason, old_values, new_values, created_at
      )
      VALUES ($1, $2, $3, 'ADMIN_OP_REVERSAL', $4, $5::jsonb, $6::jsonb, NOW())
      RETURNING id, action, reason, created_at
      `,
      [
        id,
        adminId,
        userId,
        reason,
        JSON.stringify(oldValues),
        JSON.stringify(newValues),
      ]
    );
    return result.rows[0];
  },

  async executeReversalWithHistory({
    transactionId,
    adminId,
    reason,
    idempotencyKey,
    requestHash,
    requestPath = "POST /api/v2/admin/transactions/:id/reverse",
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const idemResult = await client.query(
        `
        SELECT idempotency_key, status, actor_id, request_path, request_hash,
               response_body, response_status_code
        FROM idempotency_keys
        WHERE idempotency_key = $1
        FOR UPDATE
        `,
        [idempotencyKey]
      );

      const idemRow = idemResult.rows[0];
      if (!idemRow) {
        throw httpError(400, "Không tìm thấy khóa Idempotency-Key hợp lệ");
      }

      if (
        (idemRow.actor_id && String(idemRow.actor_id) !== String(adminId)) ||
        (idemRow.request_path && idemRow.request_path !== requestPath) ||
        (requestHash && idemRow.request_hash && idemRow.request_hash !== requestHash)
      ) {
        throw httpError(
          422,
          "Mã Idempotency-Key đã được sử dụng với dữ liệu giao dịch khác"
        );
      }

      if (idemRow.status === "SUCCESS" && idemRow.response_body) {
        await client.query("ROLLBACK");
        return {
          replayed: true,
          responseBody: idemRow.response_body,
          notificationContext: null,
        };
      }

      const txResult = await client.query(
        `
        SELECT id, transaction_type, amount, user_fee, merchant_fee,
               fee_rate_snapshot, status, linked_bank_account_id,
               source_user_id, destination_user_id, created_at
        FROM transactions
        WHERE id = $1
        FOR UPDATE
        `,
        [transactionId]
      );
      const txRow = txResult.rows[0];
      if (!txRow) {
        throw httpError(404, "Không tìm thấy giao dịch gốc");
      }

      if (txRow.transaction_type !== "TRANSFER") {
        throw httpError(
          422,
          "Chỉ hỗ trợ hoàn tiền cho giao dịch chuyển tiền P2P (TRANSFER)"
        );
      }
      if (txRow.status !== "SUCCESS") {
        throw httpError(
          422,
          "Chỉ được hoàn tiền giao dịch đang ở trạng thái Thành công (SUCCESS)"
        );
      }
      if (txRow.linked_bank_account_id) {
        throw httpError(
          422,
          "Không hỗ trợ hoàn tiền giao dịch có liên kết tài khoản ngân hàng"
        );
      }
      if (Number(txRow.merchant_fee || 0) > 0) {
        throw httpError(
          422,
          "Không hỗ trợ hoàn tiền giao dịch phát sinh phí Merchant"
        );
      }
      if (txRow.fee_rate_snapshot?.operation_type === "REVERSAL") {
        throw httpError(
          422,
          "Không thể hoàn tiền đối với giao dịch bù trừ hoàn tiền"
        );
      }
      if (
        !txRow.source_user_id ||
        !txRow.destination_user_id ||
        String(txRow.source_user_id) === String(txRow.destination_user_id)
      ) {
        throw httpError(
          422,
          "Giao dịch không có cặp ví nguồn và ví đích hợp lệ khác nhau"
        );
      }

      const existingReversal = await client.query(
        `
        SELECT id, new_values->>'transaction_id' AS reversal_tx_id
        FROM admin_user_change_history
        WHERE action = 'ADMIN_OP_REVERSAL'
          AND (new_values->>'original_transaction_id') = $1::text
        LIMIT 1
        `,
        [String(txRow.id)]
      );
      if (existingReversal.rowCount > 0) {
        const err = httpError(409, "Giao dịch này đã được hoàn tiền trước đó");
        err.code = "TRANSACTION_ALREADY_REVERSED";
        throw err;
      }

      const disputeEvents =
        await adminTransactionRepository.getDisputeEventsByTransactionId(
          String(txRow.id),
          client
        );
      const activeDisputeId = resolveActiveDisputeIdFromEvents(disputeEvents);

      // Khóa hai ví theo thứ tự UUID tăng dần để tránh deadlock.
      const sortedIds = [
        String(txRow.source_user_id),
        String(txRow.destination_user_id),
      ].sort();

      const lockedUsersRes = await client.query(
        `
        SELECT id, role, status, full_name, phone, balance
        FROM users
        WHERE id = ANY($1::uuid[])
        ORDER BY id ASC
        FOR UPDATE
        `,
        [sortedIds]
      );
      const userA = lockedUsersRes.rows.find(
        (u) => String(u.id) === String(txRow.source_user_id)
      );
      const userB = lockedUsersRes.rows.find(
        (u) => String(u.id) === String(txRow.destination_user_id)
      );

      if (!userA || !userB) {
        throw httpError(
          404,
          "Không tìm thấy thông tin ví người gửi hoặc ví người nhận"
        );
      }
      if (userA.role !== "USER" || userB.role !== "USER") {
        throw httpError(
          422,
          "Chỉ hỗ trợ hoàn tiền giao dịch P2P giữa hai tài khoản USER"
        );
      }
      if (userA.status !== "ACTIVE" || userB.status !== "ACTIVE") {
        throw httpError(
          403,
          "Cả ví người gửi cũ và ví người nhận cũ đều phải đang ở trạng thái ACTIVE"
        );
      }

      const reversalTx = await TransactionRepository.executeReversalTransfer(
        client,
        {
          sourceUser: userB,
          destUser: userA,
          amount: Number(txRow.amount),
          originalTransactionId: String(txRow.id),
          idempotencyKey,
          description: `Hoàn tiền giao dịch ${txRow.id}`,
        }
      );

      const oldValues = {
        balance_before: Number(reversalTx.sourceBalanceBefore),
      };
      const newValues = {
        transaction_id: String(reversalTx.transactionId),
        original_transaction_id: String(txRow.id),
        destination_user_id: String(userA.id),
        amount: Number(reversalTx.amount),
        reversal_type: "FULL",
        balance_after: Number(reversalTx.sourceBalanceAfter),
        dispute_id: activeDisputeId || null,
      };

      let historyRow;
      try {
        historyRow =
          await adminTransactionRepository.insertReversalAuditHistory(client, {
            adminId,
            userId: userB.id,
            reason,
            oldValues,
            newValues,
          });
      } catch (insertErr) {
        if (insertErr && insertErr.code === "23505") {
          const err = httpError(409, "Giao dịch này đã được hoàn tiền trước đó");
          err.code = "TRANSACTION_ALREADY_REVERSED";
          throw err;
        }
        throw insertErr;
      }

      const responseBody = {
        transaction_id: String(reversalTx.transactionId),
        original_transaction_id: String(txRow.id),
        transaction_type: "TRANSFER",
        action: "ADMIN_OP_REVERSAL",
        reversal_type: "FULL",
        status: reversalTx.status || "SUCCESS",
        amount: Number(reversalTx.amount),
        fee: 0,
        merchant_fee: 0,
        description: reversalTx.description,
        reason,
        debited_user_id: String(userB.id),
        debited_user_name: userB.full_name,
        debited_phone_masked: maskPhone(userB.phone),
        debited_balance_before: Number(reversalTx.sourceBalanceBefore),
        debited_balance_after: Number(reversalTx.sourceBalanceAfter),
        refunded_user_id: String(userA.id),
        refunded_user_name: userA.full_name,
        refunded_phone_masked: maskPhone(userA.phone),
        dispute_id: activeDisputeId || null,
        audit_log_id: historyRow?.id || null,
        created_at: reversalTx.createdAt,
      };

      await client.query(
        `
        UPDATE idempotency_keys
        SET status = 'SUCCESS',
            response_status_code = 200,
            response_body = $1
        WHERE idempotency_key = $2
        `,
        [JSON.stringify(responseBody), idempotencyKey]
      );

      await client.query("COMMIT");

      return {
        replayed: false,
        responseBody,
        notificationContext: {
          reversalTransactionId: String(reversalTx.transactionId),
          originalTransactionId: String(txRow.id),
          amount: Number(reversalTx.amount),
          debitedUserId: String(userB.id),
          debitedBalanceAfter: Number(reversalTx.sourceBalanceAfter),
          refundedUserId: String(userA.id),
          refundedBalanceAfter: Number(reversalTx.destBalanceAfter),
        },
      };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("executeReversalWithHistory ROLLBACK error:", rollbackErr.message);
      }
      throw err;
    } finally {
      client.release();
    }
  },

  async getClient() {
    return pool.connect();
  },
};

module.exports = adminTransactionRepository;

