const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcrypt");

const pool = require("../src/config/database");
const TransactionRepository = require("../src/modules/transaction/transaction.repository");
const adminUserRepository = require("../src/admin/user/user.repository");
const adminUserService = require("../src/admin/user/user.service");
const adminUserController = require("../src/admin/user/user.controller");
const authMiddleware = require("../src/middlewares/auth.middleware");
const socketUtil = require("../src/utils/socket");
const firebaseNotification = require("../src/utils/firebaseNotification");
const limitsDb = require("../src/utils/limits/limitsDb");

describe("Admin User P2P Operations - Comprehensive Test Suite (14 Mandatory Scenarios)", () => {
  const originalPoolQuery = pool.query.bind(pool);
  const originalPoolConnect = pool.connect.bind(pool);
  const originalEmitToUser = socketUtil.emitToUser;
  const originalSendPush = firebaseNotification.sendPushNotification;

  const ADMIN_ID = "0196ed40-0000-7000-8000-000000000001";
  const USER_A_ID = "0196ed40-0000-7000-8000-00000000000a";
  const USER_B_ID = "0196ed40-0000-7000-8000-00000000000b";
  const ADMIN_PASS = "AdminSecret@123";
  const ADMIN_PASS_HASH = bcrypt.hashSync(ADMIN_PASS, 4);

  let dbState;
  let hooks;

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function resetDbState() {
    limitsDb.invalidateLimitsCache();
    hooks = {
      beforeSelectUserForUpdate: null,
      failHistoryInsert: false,
      delayInsideTransactionMs: 0,
    };

    dbState = {
      seq: 100500,
      users: {
        [ADMIN_ID]: {
          id: ADMIN_ID,
          role: "ADMIN",
          full_name: "Admin Quản Trị",
          email: "admin@ewallet.vn",
          phone: "0900000001",
          password_hash: ADMIN_PASS_HASH,
          status: "ACTIVE",
          balance: 0,
          failed_login_attempts: 0,
          locked_until: null,
        },
        [USER_A_ID]: {
          id: USER_A_ID,
          role: "USER",
          full_name: "Nguyễn Văn A",
          email: "usera@ewallet.vn",
          phone: "0912345678",
          password_hash: "hash_a",
          status: "ACTIVE",
          balance: 2000000,
          failed_login_attempts: 0,
          locked_until: null,
        },
        [USER_B_ID]: {
          id: USER_B_ID,
          role: "USER",
          full_name: "Trần Thị B",
          email: "userb@ewallet.vn",
          phone: "0987654321",
          password_hash: "hash_b",
          status: "ACTIVE",
          balance: 500000,
          failed_login_attempts: 0,
          locked_until: null,
        },
      },
      idempotency_keys: {},
      transactions: [],
      admin_user_change_history: [],
    };
  }

  async function executeSql(targetState, sql, params = []) {
    const norm = sql.replace(/\s+/g, " ").trim();

    if (norm === "BEGIN" || norm === "COMMIT" || norm === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    // 1. Admin auth lookup by ID
    if (
      norm.includes("FROM users u WHERE u.id = $1") &&
      norm.includes("u.password_hash")
    ) {
      const u = targetState.users[params[0]];
      if (!u) return { rows: [], rowCount: 0 };
      const isLocked =
        u.locked_until != null && new Date(u.locked_until) > new Date();
      return {
        rows: [{ ...u, is_locked: isLocked }],
        rowCount: 1,
      };
    }

    // 2. Get user detail (for getUserChangeHistory & getUserDetail check)
    if (norm.includes("FROM users u WHERE u.id = $1 AND u.role")) {
      const u = targetState.users[params[0]];
      if (!u || !["USER", "MERCHANT"].includes(u.role)) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ ...u }], rowCount: 1 };
    }
    if (norm.includes("FROM user_kyc WHERE user_id = $1")) {
      return { rows: [], rowCount: 0 };
    }
    if (norm.includes("FROM linked_bank_accounts l")) {
      return { rows: [], rowCount: 0 };
    }

    // 3. Reset failed login attempts
    if (norm.startsWith("UPDATE users SET failed_login_attempts = 0")) {
      const u = targetState.users[params[0]];
      if (u) {
        u.failed_login_attempts = 0;
        u.locked_until = null;
      }
      return { rows: [], rowCount: u ? 1 : 0 };
    }

    // 4. Register failed login attempts
    if (
      norm.startsWith(
        "UPDATE users SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1"
      )
    ) {
      const [adminId, maxAttempts, lockMinutes] = params;
      const u = targetState.users[adminId];
      if (!u) return { rows: [], rowCount: 0 };
      u.failed_login_attempts = Number(u.failed_login_attempts || 0) + 1;
      if (u.failed_login_attempts >= Number(maxAttempts)) {
        u.locked_until = new Date(
          Date.now() + Number(lockMinutes) * 60 * 1000
        ).toISOString();
      }
      return {
        rows: [{ failed_login_attempts: u.failed_login_attempts }],
        rowCount: 1,
      };
    }

    // 5. Try insert idempotency key (ON CONFLICT DO NOTHING)
    if (norm.startsWith("INSERT INTO idempotency_keys")) {
      const [key, actorId, actorType, requestPath, requestHash] = params;
      if (targetState.idempotency_keys[key]) {
        return { rows: [], rowCount: 0 };
      }
      targetState.idempotency_keys[key] = {
        idempotency_key: key,
        actor_id: actorId,
        actor_type: actorType,
        request_path: requestPath,
        request_hash: requestHash,
        status: "PENDING",
        response_body: null,
        response_status_code: null,
        create_at: new Date().toISOString(),
      };
      return { rows: [{ idempotency_key: key }], rowCount: 1 };
    }

    // 6. Select idempotency key (with or without FOR UPDATE)
    if (
      norm.includes("FROM idempotency_keys WHERE idempotency_key = $1")
    ) {
      const row = targetState.idempotency_keys[params[0]];
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    // 7. Reclaim idempotency key
    if (
      norm.startsWith("UPDATE idempotency_keys SET status = 'PENDING'") &&
      norm.includes("AND actor_id = $2")
    ) {
      const [key, actorId, requestPath, requestHash, staleSeconds] = params;
      const row = targetState.idempotency_keys[key];
      if (!row) return { rows: [], rowCount: 0 };
      const isStalePending =
        row.status === "PENDING" &&
        Date.now() - new Date(row.create_at).getTime() >
        Number(staleSeconds) * 1000;
      if (
        String(row.actor_id) === String(actorId) &&
        row.request_path === requestPath &&
        row.request_hash === requestHash &&
        (row.status === "FAILED" || isStalePending)
      ) {
        row.status = "PENDING";
        row.create_at = new Date().toISOString();
        row.response_body = null;
        row.response_status_code = null;
        return { rows: [{ idempotency_key: key }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 8. Mark idempotency key FAILED
    if (
      norm.startsWith(
        "UPDATE idempotency_keys SET status = 'FAILED' WHERE idempotency_key = $1"
      )
    ) {
      const row = targetState.idempotency_keys[params[0]];
      if (row && row.status === "PENDING") {
        row.status = "FAILED";
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 9. Update idempotency key SUCCESS inside transaction
    if (
      norm.startsWith(
        "UPDATE idempotency_keys SET status = 'SUCCESS', response_status_code = 200"
      )
    ) {
      const [responseBodyJson, key] = params;
      const row = targetState.idempotency_keys[key];
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "SUCCESS";
      row.response_status_code = 200;
      row.response_body =
        typeof responseBodyJson === "string"
          ? JSON.parse(responseBodyJson)
          : responseBodyJson;
      return { rows: [], rowCount: 1 };
    }

    // 10. SELECT user FOR UPDATE inside executeTransfer
    if (
      norm.startsWith(
        "SELECT id, role, status, full_name, phone, balance FROM users WHERE id = $1 FOR UPDATE"
      )
    ) {
      const userId = params[0];
      if (hooks.beforeSelectUserForUpdate) {
        await hooks.beforeSelectUserForUpdate(userId, targetState);
      }
      const u = targetState.users[userId];
      return { rows: u ? [{ ...u }] : [], rowCount: u ? 1 : 0 };
    }

    // 11. Daily transfer limit query inside executeTransfer / getDailyUsage
    if (
      norm.includes("AS transfer_used") &&
      norm.includes("AS topup_used") &&
      norm.includes("AS withdraw_used") &&
      norm.includes("FROM transactions WHERE source_user_id = $1")
    ) {
      const sourceUserId = params[0];
      const successTxs = targetState.transactions.filter(
        (t) =>
          String(t.source_user_id) === String(sourceUserId) &&
          t.status === "SUCCESS"
      );
      const sumBucket = (predicate) =>
        successTxs
          .filter(predicate)
          .reduce(
            (sum, t) => sum + Number(t.amount) + Number(t.user_fee ?? t.fee ?? 0),
            0,
          );
      return {
        rows: [
          {
            transfer_used: sumBucket(
              (t) =>
                t.transaction_type === "TRANSFER" ||
                (t.transaction_type === "PAYMENT" &&
                  t.destination_user_id != null),
            ),
            topup_used: sumBucket((t) => t.transaction_type === "TOPUP"),
            withdraw_used: sumBucket((t) => t.transaction_type === "WITHDRAW"),
          },
        ],
        rowCount: 1,
      };
    }

    if (norm.includes("AS daily_used FROM transactions WHERE source_user_id = $1")) {
      const sourceUserId = params[0];
      let allowedTypes = ["TRANSFER", "WITHDRAW", "PAYMENT"];
      if (norm.includes("transaction_type IN ('WITHDRAW')")) {
        allowedTypes = ["WITHDRAW"];
      } else if (norm.includes("transaction_type IN ('TOPUP')")) {
        allowedTypes = ["TOPUP"];
      } else if (norm.includes("transaction_type IN ('TRANSFER'")) {
        allowedTypes = ["TRANSFER", "PAYMENT"];
      }
      const used = targetState.transactions
        .filter(
          (t) =>
            String(t.source_user_id) === String(sourceUserId) &&
            allowedTypes.includes(t.transaction_type) &&
            t.status === "SUCCESS"
        )
        .reduce(
          (sum, t) => sum + Number(t.amount) + Number(t.user_fee ?? t.fee ?? 0),
          0,
        );
      return { rows: [{ daily_used: used }], rowCount: 1 };
    }

    // 12. Update user balance
    if (norm.startsWith("UPDATE users SET balance = $1 WHERE id = $2")) {
      const [newBalance, userId] = params;
      const u = targetState.users[userId];
      if (!u) return { rows: [], rowCount: 0 };
      u.balance = Number(newBalance);
      return { rows: [], rowCount: 1 };
    }

    // 13. Insert transaction
    if (norm.startsWith("INSERT INTO transactions")) {
      if (hooks.delayInsideTransactionMs > 0) {
        await new Promise((r) => setTimeout(r, hooks.delayInsideTransactionMs));
      }
      const isNewFormat = params.length >= 14;
      const transactionType = params[0];
      const sourceUserId = params[1];
      const sourceBalanceBefore = params[2];
      const sourceBalanceAfter = params[3];
      const destinationUserId = params[4];
      const destBalanceBefore = params[5];
      const destBalanceAfter = params[6];
      const amount = params[7];
      const fee = params[8];
      const merchantFee = isNewFormat ? params[9] : 0;
      const description = isNewFormat ? params[11] : params[9];
      const idempotencyKey = isNewFormat ? params[12] : params[10];
      const status = isNewFormat ? params[13] : params[11];

      const duplicate = targetState.transactions.find(
        (t) => t.idempotency_key === idempotencyKey
      );
      if (duplicate) {
        const dupErr = new Error("duplicate key value violates unique constraint");
        dupErr.code = "23505";
        throw dupErr;
      }

      targetState.seq += 1;
      const txRow = {
        id: String(targetState.seq),
        transaction_type: transactionType,
        source_user_id: sourceUserId,
        source_balance_before: Number(sourceBalanceBefore),
        source_balance_after: Number(sourceBalanceAfter),
        destination_user_id: destinationUserId,
        dest_balance_before: Number(destBalanceBefore),
        dest_balance_after: Number(destBalanceAfter),
        amount: Number(amount),
        user_fee: Number(fee),
        merchant_fee: Number(merchantFee),
        description,
        idempotency_key: idempotencyKey,
        status,
        created_at: new Date().toISOString(),
      };
      targetState.transactions.push(txRow);
      return {
        rows: [
          {
            id: txRow.id,
            status: txRow.status,
            created_at: txRow.created_at,
          },
        ],
        rowCount: 1,
      };
    }

    // 14. Insert admin_user_change_history
    if (norm.startsWith("INSERT INTO admin_user_change_history")) {
      if (hooks.failHistoryInsert) {
        throw new Error("Simulated DB failure on admin_user_change_history");
      }
      const [adminId, userId, reason, oldValuesJson, newValuesJson] = params;
      const historyRow = {
        id: `hist-${targetState.admin_user_change_history.length + 1}`,
        admin_id: adminId,
        user_id: userId,
        action: "ADMIN_OP_P2P",
        reason,
        old_values: JSON.parse(oldValuesJson),
        new_values: JSON.parse(newValuesJson),
        created_at: new Date().toISOString(),
      };
      targetState.admin_user_change_history.push(historyRow);
      return { rows: [historyRow], rowCount: 1 };
    }

    // 15. Bi-directional history COUNT & SELECT
    if (
      norm.includes("FROM admin_user_change_history h") &&
      norm.includes("destination_user_id")
    ) {
      const userId = String(params[0]);
      const matched = targetState.admin_user_change_history.filter(
        (h) =>
          String(h.user_id) === userId ||
          (h.action === "ADMIN_OP_P2P" &&
            String(h.new_values?.destination_user_id) === userId)
      );

      if (norm.includes("COUNT(*)::INT AS total")) {
        return { rows: [{ total: matched.length }], rowCount: 1 };
      }

      const rows = matched.map((h) => {
        const admin = targetState.users[h.admin_id] || {};
        return {
          id: h.id,
          user_id: h.user_id,
          action: h.action,
          reason: h.reason,
          old_values: h.old_values,
          new_values: h.new_values,
          created_at: h.created_at,
          role_in_operation:
            String(h.user_id) === userId ? "SOURCE" : "DESTINATION",
          admin_id: admin.id,
          admin_name: admin.full_name,
          admin_email: admin.email,
        };
      });
      return { rows, rowCount: rows.length };
    }

    // 17. System configs & custom user transaction limits (limitsDb / fee.service)
    if (norm.includes("FROM user_transaction_limits")) {
      return { rows: [], rowCount: 0 };
    }

    if (norm.includes("FROM system_configs")) {
      const configs = [
        { key: "DAILY_LIMIT_TIMEZONE", value: "Asia/Ho_Chi_Minh" },
        {
          key: "USER_FEE_CONFIG",
          value: {
            rate_bps: 0,
            min_fee: 0,
            max_fee: null,
            free_threshold_amount: 0,
            transfer_fee_bps: 0,
            transfer_min_fee: 0,
            transfer_max_fee: null,
            withdraw_fee_bps: 0,
            withdraw_free_quota_per_month: 0,
            tiers: [],
          },
        },
        {
          key: "MERCHANT_FEE_CONFIG",
          value: {
            rate_bps: 100,
            min_fee: 200,
            max_fee: null,
            free_threshold_amount: 0,
            transfer_fee_bps: 0,
            transfer_min_fee: 0,
            transfer_max_fee: null,
            withdraw_fee_bps: 50,
            withdraw_free_quota_per_month: 50000000,
            monthly_plan_enabled: false,
            monthly_plan_fee: 0,
            monthly_grace_days: 7,
            tiers: [
              { from_amount: 0, rate_bps: 100 },
              { from_amount: 50000000, rate_bps: 80 },
              { from_amount: 200000000, rate_bps: 60 },
            ],
          },
        },
        {
          key: "WALLET_CAPACITY_CONFIG",
          value: {
            USER: { min_capacity: 1000000, default_capacity: 100000000, max_capacity: 1000000000 },
            MERCHANT: { min_capacity: 1000000, default_capacity: 100000000, max_capacity: 1000000000 },
          },
        },
        {
          key: "TRANSACTION_LIMIT_CONFIG",
          value: {
            USER: {
              TOPUP: { min_amount: 10000, max_amount: 50000000, daily_limit: 50000000 },
              WITHDRAW: { min_amount: 10000, max_amount: 30000000, daily_limit: 30000000 },
              TRANSFER: { min_amount: 1000, max_amount: 50000000, daily_limit: 50000000 },
              QR_PAYMENT: { min_amount: 1000, max_amount: 50000000, daily_limit: null },
            },
            MERCHANT: {
              TOPUP: { min_amount: 10000, max_amount: 50000000, daily_limit: 50000000 },
              WITHDRAW: { min_amount: 10000, max_amount: 200000000, daily_limit: 500000000 },
              TRANSFER: { min_amount: 1000, max_amount: 50000000, daily_limit: 50000000 },
              QR_PAYMENT: { min_amount: 1000, max_amount: 50000000, daily_limit: null },
            },
          },
        },
      ];
      if (norm.includes("WHERE key=$1") || norm.includes("WHERE key = $1")) {
        const hit = configs.find((c) => c.key === params[0]);
        return { rows: hit ? [{ value: hit.value }] : [], rowCount: hit ? 1 : 0 };
      }
      return { rows: configs, rowCount: configs.length };
    }

    if (norm.startsWith("INSERT INTO audit_outbox")) {
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in test mock: ${norm}`);
  }

  beforeEach(() => {
    resetDbState();

    socketUtil.emitToUser = () => { };
    firebaseNotification.sendPushNotification = async () => { };

    pool.query = async (sql, params) => executeSql(dbState, sql, params);

    pool.connect = async () => {
      let txSnapshot = null;
      let inTx = false;

      return {
        async query(sql, params) {
          const norm = sql.replace(/\s+/g, " ").trim();
          if (norm === "BEGIN") {
            txSnapshot = cloneState(dbState);
            inTx = true;
            return { rows: [], rowCount: 0 };
          }
          if (norm === "COMMIT") {
            txSnapshot = null;
            inTx = false;
            return { rows: [], rowCount: 0 };
          }
          if (norm === "ROLLBACK") {
            if (inTx && txSnapshot) {
              // Preserve idempotency_keys table outside or restore transactional changes
              dbState = txSnapshot;
            }
            txSnapshot = null;
            inTx = false;
            return { rows: [], rowCount: 0 };
          }
          return executeSql(dbState, sql, params);
        },
        release() { },
      };
    };
  });

  after(async () => {
    pool.query = originalPoolQuery;
    pool.connect = originalPoolConnect;
    socketUtil.emitToUser = originalEmitToUser;
    firebaseNotification.sendPushNotification = originalSendPush;
    try {
      await pool.end();
    } catch (_) { }
  });

  // =========================================================================
  // Kịch bản 1: Giao dịch hợp lệ + Bảo toàn tổng số dư + Tra cứu lịch sử 2 chiều
  // =========================================================================
  it("Case 1: Admin chuyển tiền P2P hợp lệ (USER A -> USER B, 500.000đ) bảo toàn tổng số dư, che SĐT người nhận, ẩn số dư B và tra cứu được lịch sử 2 chiều", async () => {
    const totalSystemMoneyBefore =
      dbState.users[USER_A_ID].balance + dbState.users[USER_B_ID].balance;

    const outcome = await adminUserService.executeAdminP2P({
      adminId: ADMIN_ID,
      sourceUserId: USER_A_ID,
      destinationUserId: USER_B_ID,
      amount: 500000,
      description: "Hỗ trợ chuyển khoản theo yêu cầu",
      reason: "Khách hàng gửi phiếu yêu cầu hỗ trợ chuyển tiền",
      authorizationReference: "TICKET-2026-00125",
      adminPassword: ADMIN_PASS,
      idempotencyKey: "idem-p2p-case-1",
    });

    assert.strictEqual(outcome.replayed, false);
    assert.strictEqual(outcome.data.amount, 500000);
    assert.strictEqual(outcome.data.fee, 0);
    assert.strictEqual(outcome.data.source_balance_before, 2000000);
    assert.strictEqual(outcome.data.source_balance_after, 1500000);
    assert.strictEqual(outcome.data.destination_user_id, USER_B_ID);
    assert.strictEqual(outcome.data.destination_phone_masked, "*********321");
    assert.strictEqual(outcome.data.execution_mode, "SIMULATED_ADMIN_P2P");
    assert.strictEqual(
      outcome.data.destBalanceAfter,
      undefined,
      "Tuyệt đối không được trả số dư của USER B trong response"
    );
    assert.strictEqual(
      outcome.data.dest_balance_after,
      undefined,
      "Tuyệt đối không được trả dest_balance_after của USER B"
    );

    // Kiểm tra bảo toàn tổng tiền trong hệ thống
    const totalSystemMoneyAfter =
      dbState.users[USER_A_ID].balance + dbState.users[USER_B_ID].balance;
    assert.strictEqual(dbState.users[USER_A_ID].balance, 1500000);
    assert.strictEqual(dbState.users[USER_B_ID].balance, 1000000);
    assert.strictEqual(totalSystemMoneyAfter, totalSystemMoneyBefore);

    // Kiểm tra bản ghi audit log tinh gọn (không lưu thừa destination_phone)
    assert.strictEqual(dbState.admin_user_change_history.length, 1);
    const auditRecord = dbState.admin_user_change_history[0];
    assert.strictEqual(auditRecord.action, "ADMIN_OP_P2P");
    assert.strictEqual(auditRecord.old_values.balance_before, 2000000);
    assert.strictEqual(auditRecord.new_values.balance_after, 1500000);
    assert.strictEqual(
      auditRecord.new_values.authorization_reference,
      "TICKET-2026-00125"
    );
    assert.strictEqual(
      auditRecord.new_values.destination_phone,
      undefined,
      "Không lưu dư thừa SĐT đầy đủ trong JSONB"
    );

    // Kiểm tra tra cứu lịch sử 2 chiều (từ cả USER A và USER B)
    const historyA = await adminUserService.getUserChangeHistory({
      userId: USER_A_ID,
    });
    const historyB = await adminUserService.getUserChangeHistory({
      userId: USER_B_ID,
    });
    assert.strictEqual(historyA.items.length, 1);
    assert.strictEqual(historyA.items[0].role_in_operation, "SOURCE");
    assert.strictEqual(historyB.items.length, 1);
    assert.strictEqual(historyB.items[0].role_in_operation, "DESTINATION");
  });

  // =========================================================================
  // Kịch bản 2: Ví nguồn không đủ số dư (422) & Kiểm tra vượt hạn mức ngày
  // =========================================================================
  it("Case 2: Ví nguồn không đủ số dư (chuyển 3.000.000đ khi chỉ có 2.000.000đ) -> từ chối 422 và ROLLBACK", async () => {
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 3000000,
          reason: "Chuyển vượt số dư",
          authorizationReference: "TICKET-2026-00002",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-2",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.match(err.message, /Số dư không đủ/);
        return true;
      }
    );

    assert.strictEqual(dbState.users[USER_A_ID].balance, 2000000);
    assert.strictEqual(dbState.users[USER_B_ID].balance, 500000);
    assert.strictEqual(dbState.transactions.length, 0);
    assert.strictEqual(dbState.admin_user_change_history.length, 0);
    assert.strictEqual(
      dbState.idempotency_keys["idem-p2p-case-2"].status,
      "FAILED"
    );
  });

  // =========================================================================
  // Kịch bản 3: USER A đang bị khóa (BLOCKED) -> 403 Forbidden
  // =========================================================================
  it("Case 3: Tài khoản nguồn USER A đang bị khóa (BLOCKED) -> từ chối 403 Forbidden", async () => {
    dbState.users[USER_A_ID].status = "BLOCKED";

    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 100000,
          reason: "Test ví nguồn bị khóa",
          authorizationReference: "TICKET-2026-00003",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-3",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.match(err.message, /bị khoá hoặc không khả dụng/);
        return true;
      }
    );

    assert.strictEqual(dbState.users[USER_A_ID].balance, 2000000);
    assert.strictEqual(dbState.transactions.length, 0);
  });

  // =========================================================================
  // Kịch bản 4: USER B đang bị khóa (BLOCKED) -> 422 Unprocessable Entity
  // =========================================================================
  it("Case 4: Tài khoản đích USER B đang bị khóa (BLOCKED) -> từ chối 422 Unprocessable Entity", async () => {
    dbState.users[USER_B_ID].status = "BLOCKED";

    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 100000,
          reason: "Test ví đích bị khóa",
          authorizationReference: "TICKET-2026-00004",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-4",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.match(err.message, /người nhận không khả dụng/);
        return true;
      }
    );

    assert.strictEqual(dbState.users[USER_A_ID].balance, 2000000);
    assert.strictEqual(dbState.users[USER_B_ID].balance, 500000);
    assert.strictEqual(dbState.transactions.length, 0);
  });

  // =========================================================================
  // Kịch bản 5: USER A trùng USER B -> 400 Bad Request
  // =========================================================================
  it("Case 5: Ví nguồn trùng với ví đích (USER A === USER B) -> từ chối 400 Bad Request", async () => {
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_A_ID,
          amount: 100000,
          reason: "Chuyển cho chính mình",
          authorizationReference: "TICKET-2026-00005",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-5",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /chính mình/);
        return true;
      }
    );
  });

  // =========================================================================
  // Kịch bản 6: Tài khoản USER thường gọi API Admin -> 403 Forbidden
  // =========================================================================
  it("Case 6: Tài khoản có role USER cố tình gọi endpoint Admin P2P -> bị chặn 403 Forbidden tại tầng phân quyền", async () => {
    const middleware = authMiddleware.requireRole("ADMIN");
    let capturedError = null;

    middleware(
      { user: { user_id: USER_A_ID, type: "USER" } },
      {},
      (err) => {
        capturedError = err;
      }
    );

    assert.ok(capturedError, "Middleware phải trả về lỗi cho role USER");
    assert.strictEqual(capturedError.statusCode, 403);
    assert.match(capturedError.message, /không có quyền truy cập/);
  });

  // =========================================================================
  // Kịch bản 7: Thiếu reason hoặc reason rỗng -> 400 Bad Request
  // =========================================================================
  it("Case 7: Quản trị viên không nhập reason (hoặc chỉ nhập khoảng trắng) -> từ chối 400 Bad Request", async () => {
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 100000,
          reason: "   ",
          authorizationReference: "TICKET-2026-00007",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-7",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /reason/i);
        return true;
      }
    );
  });

  // =========================================================================
  // Kịch bản 8: Thiếu/sai authorization_reference hoặc sai admin_password
  // =========================================================================
  it("Case 8: Từ chối khi thiếu/sai định dạng authorization_reference (400) hoặc nhập sai admin_password (401 + tăng bộ đếm lỗi)", async () => {
    // 8a. Thiếu hoặc sai định dạng authorization_reference
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 100000,
          reason: "Hỗ trợ khách hàng",
          authorizationReference: "bad", // < 5 ký tự
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-8a",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /authorization_reference/);
        return true;
      }
    );

    // 8b. Nhập sai mật khẩu Admin
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 100000,
          reason: "Hỗ trợ khách hàng",
          authorizationReference: "TICKET-2026-00008",
          adminPassword: "WrongPassword@999",
          idempotencyKey: "idem-p2p-case-8b",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.remainingAttempts, 4);
        assert.match(err.message, /Mật khẩu xác nhận/);
        return true;
      }
    );

    assert.strictEqual(dbState.users[ADMIN_ID].failed_login_attempts, 1);
    assert.strictEqual(dbState.transactions.length, 0);
  });

  // =========================================================================
  // Kịch bản 9: Gửi lại cùng Idempotency-Key với cùng nội dung -> trả kết quả cũ
  // =========================================================================
  it("Case 9: Gửi lại cùng Idempotency-Key với cùng thông số giao dịch -> trả về kết quả cũ, không trừ tiền lần 2", async () => {
    const payload = {
      adminId: ADMIN_ID,
      sourceUserId: USER_A_ID,
      destinationUserId: USER_B_ID,
      amount: 250000,
      description: "Chuyển tiền P2P",
      reason: "Xử lý phiếu hỗ trợ #9",
      authorizationReference: "TICKET-2026-00009",
      adminPassword: ADMIN_PASS,
      idempotencyKey: "idem-p2p-case-9",
    };

    const firstCall = await adminUserService.executeAdminP2P(payload);
    assert.strictEqual(firstCall.replayed, false);
    assert.strictEqual(dbState.users[USER_A_ID].balance, 1750000);
    assert.strictEqual(dbState.users[USER_B_ID].balance, 750000);

    const secondCall = await adminUserService.executeAdminP2P(payload);
    assert.strictEqual(secondCall.replayed, true);
    assert.strictEqual(
      secondCall.data.transaction_id,
      firstCall.data.transaction_id
    );
    // Số dư tuyệt đối không bị trừ lần 2
    assert.strictEqual(dbState.users[USER_A_ID].balance, 1750000);
    assert.strictEqual(dbState.users[USER_B_ID].balance, 750000);
    assert.strictEqual(dbState.transactions.length, 1);
  });

  // =========================================================================
  // Kịch bản 10: Gửi cùng Idempotency-Key nhưng thay đổi số tiền/người nhận -> 422
  // =========================================================================
  it("Case 10: Dùng lại cùng Idempotency-Key nhưng thay đổi số tiền hoặc người nhận -> từ chối 422 Unprocessable Entity", async () => {
    await adminUserService.executeAdminP2P({
      adminId: ADMIN_ID,
      sourceUserId: USER_A_ID,
      destinationUserId: USER_B_ID,
      amount: 100000,
      reason: "Giao dịch gốc",
      authorizationReference: "TICKET-2026-00010",
      adminPassword: ADMIN_PASS,
      idempotencyKey: "idem-p2p-case-10",
    });

    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 900000, // Thay đổi số tiền với cùng key
          reason: "Giao dịch gốc",
          authorizationReference: "TICKET-2026-00010",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-10",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.match(err.message, /Idempotency-Key đã được sử dụng/);
        return true;
      }
    );

    assert.strictEqual(dbState.users[USER_A_ID].balance, 1900000);
    assert.strictEqual(dbState.transactions.length, 1);
  });

  // =========================================================================
  // Kịch bản 11: Hai request đồng thời (Promise.all) dùng cùng Idempotency-Key
  // =========================================================================
  it("Case 11: Hai request đồng thời (Promise.all) dùng cùng Idempotency-Key chỉ trừ tiền đúng 1 lần", async () => {
    hooks.delayInsideTransactionMs = 30;

    const reqPayload = {
      adminId: ADMIN_ID,
      sourceUserId: USER_A_ID,
      destinationUserId: USER_B_ID,
      amount: 300000,
      reason: "Kiểm thử cạnh tranh đồng thời",
      authorizationReference: "TICKET-2026-00011",
      adminPassword: ADMIN_PASS,
      idempotencyKey: "idem-p2p-case-11",
    };

    const results = await Promise.allSettled([
      adminUserService.executeAdminP2P(reqPayload),
      adminUserService.executeAdminP2P(reqPayload),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "Chỉ 1 request thực thi thành công");
    assert.strictEqual(rejected.length, 1, "Request đồng thời còn lại bị chặn 409");
    assert.strictEqual(rejected[0].reason.statusCode, 409);

    assert.strictEqual(dbState.users[USER_A_ID].balance, 1700000);
    assert.strictEqual(dbState.users[USER_B_ID].balance, 800000);
    assert.strictEqual(dbState.transactions.length, 1);
  });

  // =========================================================================
  // Kịch bản 12: Lỗi khi ghi admin_user_change_history -> ROLLBACK toàn bộ
  // =========================================================================
  it("Case 12: Khi bước ghi admin_user_change_history gặp lỗi DB -> ROLLBACK toàn bộ số dư và giao dịch", async () => {
    hooks.failHistoryInsert = true;

    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 400000,
          reason: "Test rollback khi lỗi bảng history",
          authorizationReference: "TICKET-2026-00012",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-12",
        });
      },
      (err) => {
        assert.match(err.message, /Simulated DB failure/);
        return true;
      }
    );

    // Số dư hai ví và bảng transactions phải được khôi phục nguyên trạng
    assert.strictEqual(dbState.users[USER_A_ID].balance, 2000000);
    assert.strictEqual(dbState.users[USER_B_ID].balance, 500000);
    assert.strictEqual(dbState.transactions.length, 0);
    assert.strictEqual(dbState.admin_user_change_history.length, 0);
    assert.strictEqual(
      dbState.idempotency_keys["idem-p2p-case-12"].status,
      "FAILED"
    );
  });

  // =========================================================================
  // Kịch bản 13: Lỗi Socket và FCM sau khi đã COMMIT -> vẫn trả 200 OK
  // =========================================================================
  it("Case 13: Dịch vụ Socket và FCM ném lỗi sau khi DB đã COMMIT -> cô lập lỗi và vẫn trả về 200 OK", async () => {
    socketUtil.emitToUser = () => {
      throw new Error("Socket server disconnected");
    };
    firebaseNotification.sendPushNotification = async () => {
      throw new Error("FCM service unavailable");
    };

    const req = {
      params: { id: USER_A_ID },
      user: { user_id: ADMIN_ID, type: "ADMIN" },
      headers: { "idempotency-key": "idem-p2p-case-13" },
      body: {
        destination_user_id: USER_B_ID,
        amount: 200000,
        description: "Test lỗi Socket/FCM",
        reason: "Hỗ trợ chuyển tiền #13",
        authorization_reference: "TICKET-2026-00013",
        admin_password: ADMIN_PASS,
      },
    };

    let statusCode = null;
    let jsonPayload = null;
    let nextErr = null;

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonPayload = payload;
        return this;
      },
    };

    await adminUserController.executeAdminP2P(req, res, (err) => {
      nextErr = err;
    });

    assert.strictEqual(nextErr, null, "Controller không được đẩy lỗi ra next()");
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonPayload.status, "success");
    assert.strictEqual(jsonPayload.data.source_balance_after, 1800000);
    assert.strictEqual(dbState.users[USER_A_ID].balance, 1800000);
    assert.strictEqual(dbState.users[USER_B_ID].balance, 700000);
  });

  // =========================================================================
  // Kịch bản 14: USER A hoặc USER B vừa bị khóa ngay trước thời điểm FOR UPDATE
  // =========================================================================
  it("Case 14: USER B bị một Admin khác khóa đồng thời ngay trước khi SELECT ... FOR UPDATE giành được khóa -> phát hiện và ROLLBACK (422)", async () => {
    hooks.beforeSelectUserForUpdate = async (lockedUserId, state) => {
      if (lockedUserId === USER_B_ID) {
        // Giả lập một tiến trình khác vừa COMMIT khóa tài khoản USER B ngay trước khi giữ khóa dòng
        state.users[USER_B_ID].status = "BLOCKED";
      }
    };

    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 150000,
          reason: "Kiểm thử khóa đồng thời ngay trước FOR UPDATE",
          authorizationReference: "TICKET-2026-00014",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-14",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.match(err.message, /người nhận không khả dụng/);
        return true;
      }
    );

    assert.strictEqual(dbState.users[USER_A_ID].balance, 2000000);
    assert.strictEqual(dbState.users[USER_B_ID].balance, 500000);
    assert.strictEqual(dbState.transactions.length, 0);
    assert.strictEqual(dbState.admin_user_change_history.length, 0);
  });

  // =========================================================================
  // Bổ sung: Kiểm tra vượt hạn mức giao dịch trong ngày (50.000.000đ) sau FOR UPDATE
  // =========================================================================
  it("Bonus Case: Từ chối 422 khi tổng giao dịch trong ngày của USER A vượt quá 50.000.000đ", async () => {
    dbState.users[USER_A_ID].balance = 60000000;
    dbState.transactions.push({
      id: "100100",
      transaction_type: "TRANSFER",
      source_user_id: USER_A_ID,
      destination_user_id: USER_B_ID,
      amount: 49500000,
      user_fee: 0,
      status: "SUCCESS",
      created_at: new Date().toISOString(),
    });

    await assert.rejects(
      async () => {
        await adminUserService.executeAdminP2P({
          adminId: ADMIN_ID,
          sourceUserId: USER_A_ID,
          destinationUserId: USER_B_ID,
          amount: 1000000, // 49.5M + 1M = 50.5M > 50M
          reason: "Test vượt hạn mức ngày",
          authorizationReference: "TICKET-2026-00015",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-p2p-case-15",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.match(err.message, /Vượt quá hạn mức chuyển tiền trong ngày/);
        return true;
      }
    );

    assert.strictEqual(dbState.users[USER_A_ID].balance, 60000000);
  });

  // =========================================================================
  // Bổ sung: Kiểm tra getUserDetail trả về daily_limit và daily_used chính xác
  // =========================================================================
  it("Bonus Case 2: getUserDetail trả về daily_limit (50.000.000đ) và daily_used phản ánh tổng giao dịch thành công trong ngày", async () => {
    const detailBefore = await adminUserService.getUserDetail(USER_A_ID);
    assert.strictEqual(detailBefore.daily_limit, 50000000);
    assert.strictEqual(detailBefore.daily_used, 0);

    await adminUserService.executeAdminP2P({
      adminId: ADMIN_ID,
      sourceUserId: USER_A_ID,
      destinationUserId: USER_B_ID,
      amount: 350000,
      reason: "Kiểm tra cập nhật daily_used",
      authorizationReference: "TICKET-2026-00016",
      adminPassword: ADMIN_PASS,
      idempotencyKey: "idem-p2p-case-16",
    });

    const detailAfter = await adminUserService.getUserDetail(USER_A_ID);
    assert.strictEqual(detailAfter.daily_limit, 50000000);
    assert.strictEqual(detailAfter.daily_used, 350000);
    assert.strictEqual(detailAfter.balance, 1650000);
  });
});

