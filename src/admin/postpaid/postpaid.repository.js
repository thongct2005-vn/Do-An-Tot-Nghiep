// postpaid.repository.js: Truy vấn quản trị, khóa/mở khóa, điều chỉnh hạn mức và duyệt yêu cầu mở khóa Ví trả sau Admin.
const pool = require("../../config/database");
const { uuidv7 } = require("uuidv7");
const { httpError } = require("../../utils/common/http");
const { formatVndDot } = require("../../utils/common/amount");
const { resolveSystemPostpaidWalletId } = require("../../utils/payment/systemWallet");
const { recordAdminHistoryAndOutboxTx } = require("../shared/adminAuditRepo");
const postpaidRepository = require("../../modules/postpaid/postpaid.repository");
const { MIN_POSTPAID_CREDIT_LIMIT } = require("../../modules/postpaid/postpaidConfig");
const { resolveSafePostpaidProofPath } = require("../../utils/files/imageStorage");
const {
  AUDIT_ACTIONS,
  mapWalletRow,
  mapUnlockRequestRow,
} = require("./postpaid.helpers");

const adminPostpaidRepository = {
  AUDIT_ACTIONS,

  async getOverview(db = pool) {
    const sysWalletId = resolveSystemPostpaidWalletId();
    const [poolRes, statsRes, unlockRes, configRes] = await Promise.all([
      db.query(
        `SELECT id, full_name, phone, status, balance
           FROM users
          WHERE id = $1::uuid`,
        [sysWalletId]
      ),
      db.query(
        `SELECT
           COUNT(*)::int AS total_wallets_count,
           COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN'))::int AS open_wallets_count,
           COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_wallets_count,
           COUNT(*) FILTER (WHERE status = 'PAST_DUE')::int AS past_due_wallets_count,
           COUNT(*) FILTER (WHERE status = 'FROZEN')::int AS frozen_wallets_count,
           COUNT(*) FILTER (WHERE status = 'FROZEN' AND lock_reason = 'OVERDUE_REPEAT')::int AS frozen_repeat_wallets_count,
           COUNT(*) FILTER (WHERE status = 'INACTIVE')::int AS inactive_wallets_count,
           COALESCE(SUM(credit_limit) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN')), 0)::bigint AS total_credit_limit,
           COALESCE(SUM(used_amount) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN')), 0)::bigint AS total_used_amount,
           COALESCE(SUM(billed_amount) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN')), 0)::bigint AS total_billed_amount,
           COALESCE(SUM(service_fee_amount) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN')), 0)::bigint AS total_service_fee_amount,
           COALESCE(SUM(late_fee_amount) FILTER (WHERE status IN ('ACTIVE', 'PAST_DUE', 'FROZEN')), 0)::bigint AS total_late_fee_amount,
           COALESCE(SUM(used_amount) FILTER (WHERE status = 'PAST_DUE'), 0)::bigint AS past_due_debt_amount
         FROM postpaid_wallets`
      ),
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_unlock_requests_count,
           COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved_unlock_requests_count,
           COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected_unlock_requests_count
         FROM postpaid_unlock_requests`
      ),
      db.query(`SELECT value FROM system_configs WHERE key = 'POSTPAID_CONFIG' LIMIT 1`),
    ]);

    const poolRow = poolRes.rows[0] || null;
    const stats = statsRes.rows[0] || {};
    const unlockStats = unlockRes.rows[0] || {};
    const cfg = configRes.rows[0]?.value || null;

    return {
      pool_wallet: poolRow
        ? {
            id: poolRow.id,
            full_name: poolRow.full_name,
            phone: poolRow.phone,
            status: poolRow.status,
            balance: Number(poolRow.balance || 0),
          }
        : null,
      kpis: {
        total_wallets_count: Number(stats.total_wallets_count || 0),
        open_wallets_count: Number(stats.open_wallets_count || 0),
        active_wallets_count: Number(stats.active_wallets_count || 0),
        past_due_wallets_count: Number(stats.past_due_wallets_count || 0),
        frozen_wallets_count: Number(stats.frozen_wallets_count || 0),
        frozen_repeat_wallets_count: Number(stats.frozen_repeat_wallets_count || 0),
        inactive_wallets_count: Number(stats.inactive_wallets_count || 0),
        total_credit_limit: Number(stats.total_credit_limit || 0),
        total_used_amount: Number(stats.total_used_amount || 0),
        total_billed_amount: Number(stats.total_billed_amount || 0),
        total_service_fee_amount: Number(stats.total_service_fee_amount || 0),
        total_late_fee_amount: Number(stats.total_late_fee_amount || 0),
        past_due_debt_amount: Number(stats.past_due_debt_amount || 0),
        pending_unlock_requests_count: Number(unlockStats.pending_unlock_requests_count || 0),
        approved_unlock_requests_count: Number(unlockStats.approved_unlock_requests_count || 0),
        rejected_unlock_requests_count: Number(unlockStats.rejected_unlock_requests_count || 0),
      },
      config: cfg,
    };
  },

  async listWallets(
    { status, lockReason, search, sortBy, sortDir, limit, offset },
    db = pool
  ) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`pw.status = $${params.length}`);
    }
    if (lockReason) {
      params.push(lockReason);
      conditions.push(`pw.lock_reason = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(COALESCE(u.full_name, '') ILIKE ${p} OR COALESCE(u.phone, '') ILIKE ${p} OR COALESCE(u.email, '') ILIKE ${p} OR pw.user_id::text ILIKE ${p})`
      );
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sortExprMap = {
      used_amount: "pw.used_amount",
      credit_limit: "pw.credit_limit",
      due_date: "COALESCE(pw.overdue_cycle_due_date, pw.due_date)",
      updated_at: "pw.updated_at",
    };
    const sortExpr = sortExprMap[sortBy] || "pw.updated_at";
    const orderSql = `${sortExpr} ${sortDir} NULLS LAST, pw.user_id ASC`;

    const dataParams = [...params, limit, offset];
    const [rowsRes, countRes] = await Promise.all([
      db.query(
        `SELECT pw.*, u.full_name, u.phone, u.email, u.status AS user_status
           FROM postpaid_wallets pw
           JOIN users u ON u.id = pw.user_id
          ${whereSql}
          ORDER BY ${orderSql}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        dataParams
      ),
      db.query(
        `SELECT COUNT(*)::int AS total
           FROM postpaid_wallets pw
           JOIN users u ON u.id = pw.user_id
          ${whereSql}`,
        params
      ),
    ]);

    const vnToday = postpaidRepository.getVnDateMeta().todayDateStr;
    const totalItems = Number(countRes.rows[0]?.total || 0);
    const items = rowsRes.rows.map((row) => mapWalletRow(row, vnToday));

    return {
      items,
      pagination: {
        limit,
        offset,
        total_items: totalItems,
        has_more: offset + items.length < totalItems,
      },
    };
  },

  async getWalletDetail(userId, db = pool) {
    const walletRes = await db.query(
      `SELECT pw.*, u.full_name, u.phone, u.email, u.status AS user_status, u.created_at AS user_created_at
         FROM postpaid_wallets pw
         JOIN users u ON u.id = pw.user_id
        WHERE pw.user_id = $1::uuid`,
      [userId]
    );
    const row = walletRes.rows[0];
    if (!row) {
      throw httpError(404, "Không tìm thấy Ví trả sau của người dùng này");
    }

    const [entriesRes, unlockRes, auditRes] = await Promise.all([
      db.query(
        `SELECT id, user_id, tx_id, ref_tx_id, action, amount, delta_used,
                used_before, used_after, cycle_month, late_fee_tier, note, created_at
           FROM postpaid_entries
          WHERE user_id = $1::uuid
          ORDER BY created_at DESC, id DESC
          LIMIT 30`,
        [userId]
      ),
      db.query(
        `SELECT r.*, rev.full_name AS reviewer_name
           FROM postpaid_unlock_requests r
           LEFT JOIN users rev ON rev.id = r.reviewed_by
          WHERE r.user_id = $1::uuid
          ORDER BY r.created_at DESC
          LIMIT 20`,
        [userId]
      ),
      db.query(
        `SELECT ach.id, ach.admin_id, adm.full_name AS admin_name, adm.phone AS admin_phone,
                ach.action, ach.reason, ach.old_values, ach.new_values, ach.created_at
           FROM admin_user_change_history ach
           LEFT JOIN users adm ON adm.id = ach.admin_id
          WHERE ach.user_id = $1::uuid
            AND ach.action IN (
              'POSTPAID_WALLET_FROZEN',
              'POSTPAID_WALLET_UNFROZEN',
              'POSTPAID_LIMIT_ADJUSTED',
              'POSTPAID_UNLOCK_APPROVED',
              'POSTPAID_UNLOCK_REJECTED'
            )
          ORDER BY ach.created_at DESC, ach.id DESC
          LIMIT 30`,
        [userId]
      ),
    ]);

    const vnToday = postpaidRepository.getVnDateMeta().todayDateStr;
    return {
      wallet: {
        ...mapWalletRow(row, vnToday),
        user_created_at: row.user_created_at,
      },
      entries: entriesRes.rows.map((e) => ({
        ...e,
        amount: Number(e.amount || 0),
        delta_used: Number(e.delta_used || 0),
        used_before: Number(e.used_before || 0),
        used_after: Number(e.used_after || 0),
        late_fee_tier: e.late_fee_tier === null ? null : Number(e.late_fee_tier),
      })),
      unlock_requests: unlockRes.rows.map((r) => mapUnlockRequestRow(r)),
      audit_history: auditRes.rows,
    };
  },

  async listEntries(
    { action, userId, cycleMonth, startDate, endDate, search, limit, offset },
    db = pool
  ) {
    const conditions = [];
    const params = [];

    if (action) {
      params.push(action);
      conditions.push(`pe.action = $${params.length}`);
    }
    if (userId) {
      params.push(userId);
      conditions.push(`pe.user_id = $${params.length}::uuid`);
    }
    if (cycleMonth) {
      params.push(cycleMonth);
      conditions.push(`pe.cycle_month = $${params.length}`);
    }
    if (startDate) {
      params.push(`${startDate} 00:00:00+07:00`);
      conditions.push(`pe.created_at >= $${params.length}::timestamptz`);
    }
    if (endDate) {
      params.push(`${endDate} 00:00:00+07:00`);
      conditions.push(`pe.created_at < ($${params.length}::timestamptz + interval '1 day')`);
    }
    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(COALESCE(u.full_name, '') ILIKE ${p} OR COALESCE(u.phone, '') ILIKE ${p} OR COALESCE(u.email, '') ILIKE ${p} OR COALESCE(pe.tx_id, '') ILIKE ${p} OR COALESCE(pe.note, '') ILIKE ${p})`
      );
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rowsRes, countRes] = await Promise.all([
      db.query(
        `SELECT pe.*, u.full_name, u.phone, u.email
           FROM postpaid_entries pe
           JOIN users u ON u.id = pe.user_id
          ${whereSql}
          ORDER BY pe.created_at DESC, pe.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total
           FROM postpaid_entries pe
           JOIN users u ON u.id = pe.user_id
          ${whereSql}`,
        params
      ),
    ]);

    const totalItems = Number(countRes.rows[0]?.total || 0);
    const items = rowsRes.rows.map((e) => ({
      ...e,
      amount: Number(e.amount || 0),
      delta_used: Number(e.delta_used || 0),
      used_before: Number(e.used_before || 0),
      used_after: Number(e.used_after || 0),
      late_fee_tier: e.late_fee_tier === null ? null : Number(e.late_fee_tier),
    }));

    return {
      items,
      pagination: {
        limit,
        offset,
        total_items: totalItems,
        has_more: offset + items.length < totalItems,
      },
    };
  },

  async freezeWallet({ userId, adminId, reason }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userRes = await client.query(
        `SELECT id, role, status FROM users WHERE id = $1::uuid FOR UPDATE`,
        [userId]
      );
      const user = userRes.rows[0];
      if (!user || user.role !== "USER") {
        throw httpError(404, "Không tìm thấy tài khoản người dùng");
      }

      const pwRes = await client.query(
        `SELECT * FROM postpaid_wallets WHERE user_id = $1::uuid FOR UPDATE`,
        [userId]
      );
      const pw = pwRes.rows[0];
      if (!pw || pw.status === "INACTIVE") {
        throw httpError(404, "Ví trả sau chưa được kích hoạt");
      }
      if (pw.status === "FROZEN") {
        throw httpError(409, "Ví trả sau đã ở trạng thái tạm khóa");
      }
      if (pw.status === "PAST_DUE") {
        throw httpError(400, "Ví đang ở trạng thái quá hạn (PAST_DUE) và đã khóa chi tiêu QR");
      }
      if (pw.status !== "ACTIVE") {
        throw httpError(400, "Không thể khóa Ví trả sau ở trạng thái hiện tại");
      }

      await client.query(
        `UPDATE postpaid_wallets
            SET status = 'FROZEN',
                lock_reason = 'ADMIN_FREEZE',
                updated_at = NOW()
          WHERE user_id = $1::uuid`,
        [userId]
      );

      const historyRow = await recordAdminHistoryAndOutboxTx(client, {
        adminId,
        userId,
        action: AUDIT_ACTIONS.FROZEN,
        reason,
        oldValues: { status: pw.status, lock_reason: pw.lock_reason || null },
        newValues: { status: "FROZEN", lock_reason: "ADMIN_FREEZE" },
        extraOutbox: { target_user_id: userId },
      });

      await client.query("COMMIT");
      return {
        updated: true,
        audit_id: historyRow.id,
        status: "FROZEN",
        lock_reason: "ADMIN_FREEZE",
      };
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  },

  async unfreezeWallet({ userId, adminId, reason }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userRes = await client.query(
        `SELECT id, role FROM users WHERE id = $1::uuid FOR UPDATE`,
        [userId]
      );
      const user = userRes.rows[0];
      if (!user || user.role !== "USER") {
        throw httpError(404, "Không tìm thấy tài khoản người dùng");
      }

      const pwRes = await client.query(
        `SELECT * FROM postpaid_wallets WHERE user_id = $1::uuid FOR UPDATE`,
        [userId]
      );
      const pw = pwRes.rows[0];
      if (!pw || pw.status === "INACTIVE") {
        throw httpError(404, "Ví trả sau chưa được kích hoạt");
      }
      if (pw.status === "ACTIVE") {
        throw httpError(409, "Ví trả sau hiện đang hoạt động");
      }
      if (pw.status !== "FROZEN") {
        throw httpError(400, "Chỉ có thể mở khóa thủ công khi ví đang tạm khóa FROZEN");
      }
      if (pw.lock_reason === "OVERDUE_REPEAT") {
        throw httpError(
          409,
          "Ví đang khóa do quá hạn lặp lại (OVERDUE_REPEAT). Vui lòng duyệt thông qua hàng đợi yêu cầu mở khóa kèm chứng minh thu nhập"
        );
      }

      await client.query(
        `UPDATE postpaid_wallets
            SET status = 'ACTIVE',
                lock_reason = NULL,
                updated_at = NOW()
          WHERE user_id = $1::uuid`,
        [userId]
      );

      const historyRow = await recordAdminHistoryAndOutboxTx(client, {
        adminId,
        userId,
        action: AUDIT_ACTIONS.UNFROZEN,
        reason,
        oldValues: { status: pw.status, lock_reason: pw.lock_reason || null },
        newValues: { status: "ACTIVE", lock_reason: null },
        extraOutbox: { target_user_id: userId },
      });

      await client.query("COMMIT");
      return {
        updated: true,
        audit_id: historyRow.id,
        status: "ACTIVE",
        lock_reason: null,
      };
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  },

  async adjustCreditLimit({ userId, adminId, creditLimit, reason }) {
    if (creditLimit < MIN_POSTPAID_CREDIT_LIMIT) {
      throw httpError(
        400,
        "Hạn mức Ví trả sau do Quản trị viên điều chỉnh phải tối thiểu 2.000.000đ"
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userRes = await client.query(
        `SELECT id, role FROM users WHERE id = $1::uuid FOR UPDATE`,
        [userId]
      );
      const user = userRes.rows[0];
      if (!user || user.role !== "USER") {
        throw httpError(404, "Không tìm thấy tài khoản người dùng");
      }

      const pwRes = await client.query(
        `SELECT * FROM postpaid_wallets WHERE user_id = $1::uuid FOR UPDATE`,
        [userId]
      );
      const pw = pwRes.rows[0];
      if (!pw || pw.status === "INACTIVE") {
        throw httpError(404, "Ví trả sau chưa được kích hoạt");
      }

      const oldLimit = Number(pw.credit_limit || 0);
      const usedAmount = Number(pw.used_amount || 0);
      if (creditLimit < usedAmount) {
        throw httpError(
          422,
          `Hạn mức mới (${formatVndDot(creditLimit)}) không được nhỏ hơn dư nợ đang sử dụng (${formatVndDot(usedAmount)})`
        );
      }
      if (creditLimit === oldLimit) {
        throw httpError(409, "Hạn mức mới trùng với hạn mức hiện tại");
      }

      await client.query(
        `UPDATE postpaid_wallets
            SET credit_limit = $1,
                updated_at = NOW()
          WHERE user_id = $2::uuid`,
        [creditLimit, userId]
      );

      const cycleMonth = pw.current_cycle_month || postpaidRepository.getVnDateMeta().cycleMonth;
      await client.query(
        `INSERT INTO postpaid_entries (
           id, user_id, action, amount, delta_used, used_before, used_after, cycle_month, note
         )
         VALUES ($1, $2::uuid, 'LIMIT_ADJUST', $3, 0, $4, $4, $5, $6)`,
        [
          uuidv7(),
          userId,
          Math.abs(creditLimit - oldLimit),
          usedAmount,
          cycleMonth,
          `Quản trị viên điều chỉnh hạn mức: ${formatVndDot(oldLimit)} → ${formatVndDot(creditLimit)} (${reason})`,
        ]
      );

      const historyRow = await recordAdminHistoryAndOutboxTx(client, {
        adminId,
        userId,
        action: AUDIT_ACTIONS.LIMIT_ADJUSTED,
        reason,
        oldValues: { credit_limit: oldLimit },
        newValues: { credit_limit: creditLimit },
        extraOutbox: { target_user_id: userId },
      });

      await client.query("COMMIT");
      return {
        updated: true,
        audit_id: historyRow.id,
        old_credit_limit: oldLimit,
        credit_limit: creditLimit,
        available_limit: Math.max(0, creditLimit - usedAmount),
      };
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  },

  async listUnlockRequests({ status, search, limit, offset }, db = pool) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(COALESCE(u.full_name, '') ILIKE ${p} OR COALESCE(u.phone, '') ILIKE ${p} OR COALESCE(u.email, '') ILIKE ${p} OR r.user_id::text ILIKE ${p})`
      );
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rowsRes, countRes] = await Promise.all([
      db.query(
        `SELECT r.*, u.full_name, u.phone, u.email,
                pw.status AS wallet_status, pw.lock_reason AS wallet_lock_reason,
                pw.credit_limit AS current_credit_limit,
                rev.full_name AS reviewer_name
           FROM postpaid_unlock_requests r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN postpaid_wallets pw ON pw.user_id = r.user_id
           LEFT JOIN users rev ON rev.id = r.reviewed_by
          ${whereSql}
          ORDER BY (r.status = 'PENDING') DESC, r.created_at DESC, r.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total
           FROM postpaid_unlock_requests r
           JOIN users u ON u.id = r.user_id
          ${whereSql}`,
        params
      ),
    ]);

    const totalItems = Number(countRes.rows[0]?.total || 0);
    const items = rowsRes.rows.map((r) => mapUnlockRequestRow(r));
    return {
      items,
      pagination: {
        limit,
        offset,
        total_items: totalItems,
        has_more: offset + items.length < totalItems,
      },
    };
  },

  async getUnlockProofFilePath({ requestId, proofIndex }, db = pool) {
    const res = await db.query(
      `SELECT id, proof_image_paths FROM postpaid_unlock_requests WHERE id = $1::uuid`,
      [requestId]
    );
    const row = res.rows[0];
    if (!row) {
      throw httpError(404, "Không tìm thấy hồ sơ yêu cầu mở khóa");
    }
    const paths = Array.isArray(row.proof_image_paths) ? row.proof_image_paths : [];
    if (proofIndex < 0 || proofIndex >= paths.length) {
      throw httpError(404, "Không tìm thấy ảnh chứng minh thu nhập tại vị trí yêu cầu");
    }
    return resolveSafePostpaidProofPath({ storedName: paths[proofIndex] });
  },

  async approveUnlockRequest({ requestId, adminId, reason }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // --- BƯỚC 1: Khóa hồ sơ yêu cầu mở khóa (FOR UPDATE) để tránh 2 admin duyệt trùng cùng lúc ---
      const reqRes = await client.query(
        `SELECT * FROM postpaid_unlock_requests WHERE id = $1::uuid FOR UPDATE`,
        [requestId]
      );
      const reqRow = reqRes.rows[0];
      if (!reqRow) {
        throw httpError(404, "Không tìm thấy hồ sơ yêu cầu mở khóa");
      }
      // Chỉ cho phép duyệt hồ sơ đang chờ xử lý (PENDING)
      if (reqRow.status !== "PENDING") {
        throw httpError(409, "Hồ sơ yêu cầu mở khóa này đã được xử lý trước đó");
      }

      // --- BƯỚC 2: Khóa ví trả sau của user và xác nhận đủ điều kiện mở khóa ---
      const pwRes = await client.query(
        `SELECT * FROM postpaid_wallets WHERE user_id = $1::uuid FOR UPDATE`,
        [reqRow.user_id]
      );
      const pw = pwRes.rows[0];
      if (!pw || pw.status === "INACTIVE") {
        throw httpError(404, "Không tìm thấy Ví trả sau của người dùng");
      }
      if (pw.status === "ACTIVE") {
        throw httpError(409, "Ví trả sau đã được mở lại trước đó");
      }
      // Luồng duyệt ảnh chứng minh thu nhập chỉ áp dụng cho ví đang khóa do quá hạn lặp lại (OVERDUE_REPEAT)
      if (pw.status !== "FROZEN" || pw.lock_reason !== "OVERDUE_REPEAT") {
        throw httpError(409, "Ví không còn ở trạng thái khóa OVERDUE_REPEAT");
      }
      // Bắt buộc user đã tất toán hết nợ gốc sao kê, phí dịch vụ và phí trễ hạn trước khi mở lại
      if (
        Number(pw.billed_amount) > 0 ||
        Number(pw.service_fee_amount) > 0 ||
        Number(pw.late_fee_amount) > 0
      ) {
        throw httpError(422, "Ví vẫn còn dư nợ quá hạn chưa tất toán, chưa thể duyệt mở khóa");
      }

      // --- BƯỚC 3: Mở khóa ví từ FROZEN (OVERDUE_REPEAT) -> ACTIVE ---
      // Lưu ý: chỉ xóa lock_reason và mở trạng thái ACTIVE; giữ nguyên credit_limit (nếu đã bị giảm)
      // và giữ nguyên overdue_count >= 2 để theo dõi lịch sử quá hạn của tài khoản
      await client.query(
        `UPDATE postpaid_wallets
            SET status = 'ACTIVE',
                lock_reason = NULL,
                updated_at = NOW()
          WHERE user_id = $1::uuid`,
        [reqRow.user_id]
      );

      // --- BƯỚC 4: Cập nhật hồ sơ yêu cầu mở khóa sang APPROVED kèm người duyệt & lý do ---
      await client.query(
        `UPDATE postpaid_unlock_requests
            SET status = 'APPROVED',
                reviewed_by = $1::uuid,
                admin_note = $2,
                reviewed_at = NOW(),
                updated_at = NOW()
          WHERE id = $3::uuid`,
        [adminId, reason, requestId]
      );

      // --- BƯỚC 5: Ghi log thay đổi vào bảng lịch sử quản trị viên và audit_outbox rồi commit ---
      const historyRow = await recordAdminHistoryAndOutboxTx(client, {
        adminId,
        userId: reqRow.user_id,
        action: AUDIT_ACTIONS.UNLOCK_APPROVED,
        reason,
        oldValues: {
          status: pw.status,
          lock_reason: pw.lock_reason,
          request_status: reqRow.status,
          credit_limit: Number(pw.credit_limit || 0),
          overdue_count: Number(pw.overdue_count || 0),
        },
        newValues: {
          status: "ACTIVE",
          lock_reason: null,
          request_status: "APPROVED",
          credit_limit: Number(pw.credit_limit || 0),
          overdue_count: Number(pw.overdue_count || 0),
        },
        extraOutbox: { target_user_id: reqRow.user_id, unlock_request_id: requestId },
      });

      await client.query("COMMIT");
      return {
        request_id: requestId,
        user_id: reqRow.user_id,
        status: "APPROVED",
        wallet_status: "ACTIVE",
        lock_reason: null,
        credit_limit: Number(pw.credit_limit || 0),
        overdue_count: Number(pw.overdue_count || 0),
        audit_id: historyRow.id,
      };
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  },

  async rejectUnlockRequest({ requestId, adminId, reason }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const reqRes = await client.query(
        `SELECT * FROM postpaid_unlock_requests WHERE id = $1::uuid FOR UPDATE`,
        [requestId]
      );
      const reqRow = reqRes.rows[0];
      if (!reqRow) {
        throw httpError(404, "Không tìm thấy hồ sơ yêu cầu mở khóa");
      }
      if (reqRow.status !== "PENDING") {
        throw httpError(409, "Hồ sơ yêu cầu mở khóa này đã được xử lý trước đó");
      }

      const pwRes = await client.query(
        `SELECT status, lock_reason FROM postpaid_wallets WHERE user_id = $1::uuid FOR UPDATE`,
        [reqRow.user_id]
      );
      const pw = pwRes.rows[0] || { status: null, lock_reason: null };

      await client.query(
        `UPDATE postpaid_unlock_requests
            SET status = 'REJECTED',
                reviewed_by = $1::uuid,
                admin_note = $2,
                reviewed_at = NOW(),
                updated_at = NOW()
          WHERE id = $3::uuid`,
        [adminId, reason, requestId]
      );

      const historyRow = await recordAdminHistoryAndOutboxTx(client, {
        adminId,
        userId: reqRow.user_id,
        action: AUDIT_ACTIONS.UNLOCK_REJECTED,
        reason,
        oldValues: {
          status: pw.status,
          lock_reason: pw.lock_reason,
          request_status: reqRow.status,
        },
        newValues: {
          status: pw.status,
          lock_reason: pw.lock_reason,
          request_status: "REJECTED",
          admin_note: reason,
        },
        extraOutbox: { target_user_id: reqRow.user_id, unlock_request_id: requestId },
      });

      await client.query("COMMIT");
      return {
        request_id: requestId,
        user_id: reqRow.user_id,
        status: "REJECTED",
        wallet_status: pw.status,
        lock_reason: pw.lock_reason,
        admin_note: reason,
        audit_id: historyRow.id,
      };
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  },
};

module.exports = adminPostpaidRepository;
