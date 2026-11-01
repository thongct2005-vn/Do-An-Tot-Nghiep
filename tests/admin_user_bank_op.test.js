const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcrypt");

const pool = require("../src/config/database");
const adminUserRepository = require("../src/admin/user/user.repository");
const adminUserService = require("../src/admin/user/user.service");
const adminUserController = require("../src/admin/user/user.controller");
const socketUtil = require("../src/utils/socket");
const firebaseNotification = require("../src/utils/fireBaseNotification");

describe("Admin User Bank Operations (Topup & Withdraw) - Comprehensive Test Suite", () => {
  const originalPoolQuery = pool.query.bind(pool);
  const originalPoolConnect = pool.connect.bind(pool);
  const originalEmitToUser = socketUtil.emitToUser;
  const originalSendPush = firebaseNotification.sendPushNotification;

  const ADMIN_ID = "0196ed40-0000-7000-8000-000000000001";
  const USER_ACTIVE_ID = "0196ed40-0000-7000-8000-00000000000a";
  const USER_BLOCKED_ID = "0196ed40-0000-7000-8000-00000000000b";
  const BANK_ACC_VALID_ID = "0196ed40-0000-7000-8000-0000000000b1";
  const BANK_ACC_OTHER_USER_ID = "0196ed40-0000-7000-8000-0000000000b2";

  const ADMIN_PASS = "AdminSecret@123";
  const ADMIN_PASS_HASH = bcrypt.hashSync(ADMIN_PASS, 4);

  let dbState;
  let hooks;

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function resetDbState() {
    hooks = {
      failHistoryInsert: false,
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
        [USER_ACTIVE_ID]: {
          id: USER_ACTIVE_ID,
          role: "USER",
          full_name: "Nguyễn Văn A",
          email: "usera@ewallet.vn",
          phone: "0912345678",
          password_hash: "hash_a",
          status: "ACTIVE",
          balance: 1000000,
          failed_login_attempts: 0,
          locked_until: null,
        },
        [USER_BLOCKED_ID]: {
          id: USER_BLOCKED_ID,
          role: "USER",
          full_name: "Trần Thị Khóa",
          email: "user_blocked@ewallet.vn",
          phone: "0987654321",
          password_hash: "hash_b",
          status: "BLOCKED",
          balance: 500000,
          failed_login_attempts: 0,
          locked_until: null,
        },
      },
      linked_bank_accounts: {
        [BANK_ACC_VALID_ID]: {
          id: BANK_ACC_VALID_ID,
          user_id: USER_ACTIVE_ID,
          bank_name: "Vietcombank",
          account_number: "0332330072",
          status: "ACTIVE",
        },
        [BANK_ACC_OTHER_USER_ID]: {
          id: BANK_ACC_OTHER_USER_ID,
          user_id: USER_BLOCKED_ID,
          bank_name: "Techcombank",
          account_number: "1903456789",
          status: "ACTIVE",
        },
      },
      idempotency_keys: {},
      transactions: [],
      admin_user_change_history: [],
      audit_outbox: [],
    };
  }

  async function executeSql(targetState, sql, params = []) {
    const norm = sql.replace(/\s+/g, " ").trim();

    if (norm === "BEGIN" || norm === "COMMIT" || norm === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    // 1. Admin auth lookup
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

    // 2. Reset admin failed login
    if (norm.startsWith("UPDATE users SET failed_login_attempts = 0")) {
      const u = targetState.users[params[0]];
      if (u) {
        u.failed_login_attempts = 0;
        u.locked_until = null;
      }
      return { rows: [], rowCount: u ? 1 : 0 };
    }

    // 3. Register admin failed login
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

    // 4. Try insert idempotency key
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

    // 5. Select idempotency key
    if (norm.includes("FROM idempotency_keys WHERE idempotency_key = $1")) {
      const row = targetState.idempotency_keys[params[0]];
      return {
        rows: row ? [{ ...row }] : [],
        rowCount: row ? 1 : 0,
      };
    }

    // 6. Reclaim idempotency key
    if (
      norm.startsWith("UPDATE idempotency_keys") &&
      norm.includes("SET status = 'PENDING'")
    ) {
      const [key, actorId, requestPath, requestHash] = params;
      const existing = targetState.idempotency_keys[key];
      if (!existing) return { rows: [], rowCount: 0 };

      if (
        String(existing.actor_id) === String(actorId) &&
        existing.request_path === requestPath &&
        existing.request_hash === requestHash &&
        existing.status !== "SUCCESS"
      ) {
        existing.status = "PENDING";
        existing.response_body = null;
        existing.response_status_code = null;
        return { rows: [{ idempotency_key: key }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 7. Mark idempotency key failed
    if (
      norm.startsWith("UPDATE idempotency_keys") &&
      norm.includes("SET status = 'FAILED'")
    ) {
      const key = params[0];
      if (targetState.idempotency_keys[key]) {
        targetState.idempotency_keys[key].status = "FAILED";
      }
      return { rows: [], rowCount: 1 };
    }

    // 8. Update idempotency key success
    if (
      norm.startsWith("UPDATE idempotency_keys") &&
      norm.includes("SET status = 'SUCCESS'")
    ) {
      const [body, key] = params;
      const existing = targetState.idempotency_keys[key];
      if (existing) {
        existing.status = "SUCCESS";
        existing.response_status_code = 200;
        existing.response_body =
          typeof body === "string" ? JSON.parse(body) : body;
      }
      return { rows: [], rowCount: existing ? 1 : 0 };
    }

    // 9. Select user FOR UPDATE
    if (
      norm.includes("FROM users WHERE id = $1 FOR UPDATE") ||
      norm.includes("FROM users u WHERE u.id = $1 FOR UPDATE")
    ) {
      const u = targetState.users[params[0]];
      return {
        rows: u ? [{ ...u }] : [],
        rowCount: u ? 1 : 0,
      };
    }

    // 10. Select linked bank account FOR UPDATE
    if (norm.includes("FROM linked_bank_accounts lba")) {
      const [bankId, userId] = params;
      const acc = targetState.linked_bank_accounts[bankId];
      if (acc && String(acc.user_id) === String(userId) && acc.status === "ACTIVE") {
        return {
          rows: [
            {
              id: acc.id,
              account_number: acc.account_number,
              bank_name: acc.bank_name,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }

    // 11. Select daily limit used
    if (norm.includes("COALESCE(SUM(amount), 0) AS daily_used")) {
      const userId = params[0];
      const used = targetState.transactions
        .filter(
          (t) =>
            t.source_user_id === userId &&
            t.status === "SUCCESS" &&
            ["TRANSFER", "WITHDRAW", "PAYMENT"].includes(t.transaction_type)
        )
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      return {
        rows: [{ daily_used: used }],
        rowCount: 1,
      };
    }

    // 12. Update user balance
    if (norm.startsWith("UPDATE users SET balance = $1")) {
      const [newBal, userId] = params;
      if (targetState.users[userId]) {
        targetState.users[userId].balance = Number(newBal);
      }
      return { rows: [], rowCount: 1 };
    }

    // 13. Insert transaction
    if (norm.startsWith("INSERT INTO transactions")) {
      targetState.seq += 1;
      const txId = `TX_${targetState.seq}`;
      const [
        type,
        userId,
        sourceBefore,
        sourceAfter,
        amount,
        fee,
        idempotencyKey,
        desc,
        linkedBankId,
      ] = params;
      const record = {
        id: txId,
        transaction_type: type,
        source_user_id: userId,
        source_balance_before: Number(sourceBefore),
        source_balance_after: Number(sourceAfter),
        amount: Number(amount),
        fee: Number(fee || 0),
        idempotency_key: idempotencyKey,
        status: "SUCCESS",
        description: desc,
        linked_bank_account_id: linkedBankId,
        created_at: new Date().toISOString(),
      };
      targetState.transactions.push(record);
      return {
        rows: [{ id: txId, status: "SUCCESS", created_at: record.created_at }],
        rowCount: 1,
      };
    }

    // 14. Insert audit outbox
    if (norm.startsWith("INSERT INTO audit_outbox")) {
      const [id, eventType, payload] = params;
      targetState.audit_outbox.push({
        id,
        event_type: eventType,
        payload: typeof payload === "string" ? JSON.parse(payload) : payload,
      });
      return { rows: [], rowCount: 1 };
    }

    // 15. Insert admin user change history
    if (norm.startsWith("INSERT INTO admin_user_change_history")) {
      if (hooks.failHistoryInsert) {
        throw new Error("Simulated Database Error: Disk Full or Constraint Violation");
      }
      targetState.seq += 1;
      const histId = `HIST_${targetState.seq}`;
      const [adminId, userId, action, reason, oldVal, newVal] = params;
      const record = {
        id: histId,
        admin_id: adminId,
        user_id: userId,
        action,
        reason,
        old_values: typeof oldVal === "string" ? JSON.parse(oldVal) : oldVal,
        new_values: typeof newVal === "string" ? JSON.parse(newVal) : newVal,
        created_at: new Date().toISOString(),
      };
      targetState.admin_user_change_history.push(record);
      return {
        rows: [{ id: histId, action, reason, created_at: record.created_at }],
        rowCount: 1,
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${norm}`);
  }

  beforeEach(() => {
    resetDbState();

    pool.query = async (sql, params) => {
      return executeSql(dbState, sql, params);
    };

    pool.connect = async () => {
      const transactionSnapshot = cloneState(dbState);
      let inTransaction = false;

      return {
        query: async (sql, params) => {
          const norm = sql.replace(/\s+/g, " ").trim();
          if (norm === "BEGIN") {
            inTransaction = true;
            return { rows: [], rowCount: 0 };
          }
          if (norm === "COMMIT") {
            if (inTransaction) {
              inTransaction = false;
              Object.assign(dbState, transactionSnapshot);
            }
            return { rows: [], rowCount: 0 };
          }
          if (norm === "ROLLBACK") {
            inTransaction = false;
            return { rows: [], rowCount: 0 };
          }
          return executeSql(
            inTransaction ? transactionSnapshot : dbState,
            sql,
            params
          );
        },
        release: () => {},
      };
    };
  });

  after(async () => {
    pool.query = originalPoolQuery;
    pool.connect = originalPoolConnect;
    socketUtil.emitToUser = originalEmitToUser;
    firebaseNotification.sendPushNotification = originalSendPush;
    await pool.end();
  });

  it("Case 1: Quản trị viên nạp tiền mô phỏng thành công (TOPUP +500.000đ)", async () => {
    let socketEmitted = false;
    let pushSent = false;
    socketUtil.emitToUser = (uid, event, data) => {
      if (uid === USER_ACTIVE_ID && event === "wallet_balance_updated" && data.type === "TOPUP") {
        socketEmitted = true;
      }
    };
    firebaseNotification.sendPushNotification = async (uid, payload) => {
      if (uid === USER_ACTIVE_ID && payload.data?.type === "TOPUP_MONEY") {
        pushSent = true;
      }
    };

    const res = await adminUserService.executeAdminTopup({
      adminId: ADMIN_ID,
      userId: USER_ACTIVE_ID,
      linkedBankAccountId: BANK_ACC_VALID_ID,
      amount: 500000,
      description: "Nạp tiền bù lỗi hệ thống",
      reason: "Hỗ trợ khách hàng nạp tiền theo yêu cầu hotline",
      authorizationReference: "TICKET-2026-001",
      adminPassword: ADMIN_PASS,
      idempotencyKey: "idem-topup-001",
    });

    assert.strictEqual(res.replayed, false);
    assert.strictEqual(res.data.transaction_type, "TOPUP");
    assert.strictEqual(res.data.balance_before, 1000000);
    assert.strictEqual(res.data.balance_after, 1500000);
    assert.strictEqual(res.data.amount, 500000);
    assert.strictEqual(res.data.bank_name, "Vietcombank");
    assert.strictEqual(dbState.users[USER_ACTIVE_ID].balance, 1500000);

    const history = dbState.admin_user_change_history.find(
      (h) => h.action === "ADMIN_OP_TOPUP"
    );
    assert.ok(history);
    assert.strictEqual(history.new_values.balance_after, 1500000);
    assert.strictEqual(history.reason, "Hỗ trợ khách hàng nạp tiền theo yêu cầu hotline");
  });

  it("Case 2: Quản trị viên rút tiền mô phỏng thành công (WITHDRAW -300.000đ)", async () => {
    let socketEmitted = false;
    let pushSent = false;
    socketUtil.emitToUser = (uid, event, data) => {
      if (uid === USER_ACTIVE_ID && event === "wallet_balance_updated" && data.type === "WITHDRAW") {
        socketEmitted = true;
      }
    };
    firebaseNotification.sendPushNotification = async (uid, payload) => {
      if (uid === USER_ACTIVE_ID && payload.data?.type === "WITHDRAW_MONEY") {
        pushSent = true;
      }
    };

    const res = await adminUserService.executeAdminWithdraw({
      adminId: ADMIN_ID,
      userId: USER_ACTIVE_ID,
      linkedBankAccountId: BANK_ACC_VALID_ID,
      amount: 300000,
      reason: "Thu hồi tiền hoàn trả sai",
      authorizationReference: "TICKET-2026-002",
      adminPassword: ADMIN_PASS,
      idempotencyKey: "idem-withdraw-001",
    });

    assert.strictEqual(res.replayed, false);
    assert.strictEqual(res.data.transaction_type, "WITHDRAW");
    assert.strictEqual(res.data.balance_before, 1000000);
    assert.strictEqual(res.data.balance_after, 700000);
    assert.strictEqual(res.data.amount, 300000);
    assert.strictEqual(dbState.users[USER_ACTIVE_ID].balance, 700000);

    const history = dbState.admin_user_change_history.find(
      (h) => h.action === "ADMIN_OP_WITHDRAW"
    );
    assert.ok(history);
    assert.strictEqual(history.new_values.balance_after, 700000);
  });

  it("Case 3: Rút tiền vượt quá số dư ví người dùng -> từ chối 422 và ROLLBACK", async () => {
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminWithdraw({
          adminId: ADMIN_ID,
          userId: USER_ACTIVE_ID,
          linkedBankAccountId: BANK_ACC_VALID_ID,
          amount: 2000000, // Ví chỉ có 1.000.000đ
          reason: "Rút tiền vượt số dư",
          authorizationReference: "TICKET-2026-003",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-withdraw-overbalance",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.match(err.message, /không đủ/);
        return true;
      }
    );

    // Bảo toàn số dư ví
    assert.strictEqual(dbState.users[USER_ACTIVE_ID].balance, 1000000);
    assert.strictEqual(dbState.transactions.length, 0);
  });

  it("Case 4: Rút tiền vượt hạn mức giao dịch trong ngày (50.000.000đ) -> từ chối 422", async () => {
    // Cho user có số dư lớn
    dbState.users[USER_ACTIVE_ID].balance = 100000000;
    // Giả lập user đã giao dịch 40.000.000đ trong ngày
    dbState.transactions.push({
      id: "TX_OLD",
      source_user_id: USER_ACTIVE_ID,
      transaction_type: "WITHDRAW",
      amount: 40000000,
      status: "SUCCESS",
    });

    await assert.rejects(
      async () => {
        await adminUserService.executeAdminWithdraw({
          adminId: ADMIN_ID,
          userId: USER_ACTIVE_ID,
          linkedBankAccountId: BANK_ACC_VALID_ID,
          amount: 15000000, // 40m + 15m = 55m > 50m
          reason: "Rút vượt hạn mức ngày",
          authorizationReference: "TICKET-2026-004",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-withdraw-overlimit",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.match(err.message, /hạn mức rút tiền trong ngày/);
        return true;
      }
    );

    assert.strictEqual(dbState.users[USER_ACTIVE_ID].balance, 100000000);
  });

  it("Case 5: Tài khoản người dùng đang bị khóa (BLOCKED) -> từ chối 403 Forbidden", async () => {
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminTopup({
          adminId: ADMIN_ID,
          userId: USER_BLOCKED_ID,
          linkedBankAccountId: BANK_ACC_OTHER_USER_ID,
          amount: 500000,
          reason: "Cố nạp cho tài khoản bị khóa",
          authorizationReference: "TICKET-2026-005",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-blocked-user",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.match(err.message, /bị khóa/);
        return true;
      }
    );

    assert.strictEqual(dbState.users[USER_BLOCKED_ID].balance, 500000);
  });

  it("Case 6: Ngân hàng liên kết không thuộc về người dùng -> từ chối 404 Not Found", async () => {
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminTopup({
          adminId: ADMIN_ID,
          userId: USER_ACTIVE_ID,
          linkedBankAccountId: BANK_ACC_OTHER_USER_ID, // Ngân hàng của USER_BLOCKED_ID
          amount: 500000,
          reason: "Nạp sai ngân hàng",
          authorizationReference: "TICKET-2026-006",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-wrong-bank",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 404);
        assert.match(err.message, /ngân hàng liên kết/);
        return true;
      }
    );
  });

  it("Case 7: Sai mật khẩu Quản trị viên -> từ chối 401 và tăng bộ đếm failed_login_attempts", async () => {
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminTopup({
          adminId: ADMIN_ID,
          userId: USER_ACTIVE_ID,
          linkedBankAccountId: BANK_ACC_VALID_ID,
          amount: 500000,
          reason: "Mật khẩu sai",
          authorizationReference: "TICKET-2026-007",
          adminPassword: "WrongPassword@999",
          idempotencyKey: "idem-wrong-pass",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );

    assert.strictEqual(dbState.users[ADMIN_ID].failed_login_attempts, 1);
  });

  it("Case 8: Thiếu lý do hoặc mã ủy quyền sai định dạng -> từ chối 400 Bad Request", async () => {
    // Thiếu reason (dưới 5 ký tự)
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminTopup({
          adminId: ADMIN_ID,
          userId: USER_ACTIVE_ID,
          linkedBankAccountId: BANK_ACC_VALID_ID,
          amount: 500000,
          reason: "abc", // Quá ngắn
          authorizationReference: "TICKET-2026-008",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-short-reason",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );

    // Sai định dạng authorization_reference
    await assert.rejects(
      async () => {
        await adminUserService.executeAdminTopup({
          adminId: ADMIN_ID,
          userId: USER_ACTIVE_ID,
          linkedBankAccountId: BANK_ACC_VALID_ID,
          amount: 500000,
          reason: "Lý do hợp lệ dài hơn 5 ký tự",
          authorizationReference: "@@##", // Ký tự đặc biệt không hợp lệ
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-invalid-auth-ref",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });

  it("Case 9: Gửi lại cùng Idempotency-Key với cùng thông số -> replay kết quả cũ", async () => {
    const key = "idem-replay-001";
    const res1 = await adminUserService.executeAdminTopup({
      adminId: ADMIN_ID,
      userId: USER_ACTIVE_ID,
      linkedBankAccountId: BANK_ACC_VALID_ID,
      amount: 200000,
      reason: "Nạp lần 1",
      authorizationReference: "TICKET-2026-009",
      adminPassword: ADMIN_PASS,
      idempotencyKey: key,
    });
    assert.strictEqual(res1.replayed, false);
    assert.strictEqual(dbState.users[USER_ACTIVE_ID].balance, 1200000);

    const res2 = await adminUserService.executeAdminTopup({
      adminId: ADMIN_ID,
      userId: USER_ACTIVE_ID,
      linkedBankAccountId: BANK_ACC_VALID_ID,
      amount: 200000,
      reason: "Nạp lần 1",
      authorizationReference: "TICKET-2026-009",
      adminPassword: ADMIN_PASS,
      idempotencyKey: key,
    });
    assert.strictEqual(res2.replayed, true);
    // Số dư không bị tăng lần 2
    assert.strictEqual(dbState.users[USER_ACTIVE_ID].balance, 1200000);
    assert.strictEqual(res2.data.transaction_id, res1.data.transaction_id);
  });

  it("Case 10: Dùng lại cùng Idempotency-Key nhưng đổi số tiền -> từ chối 422 Unprocessable Entity", async () => {
    const key = "idem-conflict-001";
    await adminUserService.executeAdminTopup({
      adminId: ADMIN_ID,
      userId: USER_ACTIVE_ID,
      linkedBankAccountId: BANK_ACC_VALID_ID,
      amount: 200000,
      reason: "Giao dịch chuẩn",
      authorizationReference: "TICKET-2026-010",
      adminPassword: ADMIN_PASS,
      idempotencyKey: key,
    });

    await assert.rejects(
      async () => {
        await adminUserService.executeAdminTopup({
          adminId: ADMIN_ID,
          userId: USER_ACTIVE_ID,
          linkedBankAccountId: BANK_ACC_VALID_ID,
          amount: 500000, // Đổi số tiền
          reason: "Giao dịch chuẩn",
          authorizationReference: "TICKET-2026-010",
          adminPassword: ADMIN_PASS,
          idempotencyKey: key,
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.match(err.message, /dữ liệu giao dịch khác/);
        return true;
      }
    );
  });

  it("Case 11: Khi ghi admin_user_change_history lỗi -> ROLLBACK toàn bộ", async () => {
    hooks.failHistoryInsert = true;

    await assert.rejects(
      async () => {
        await adminUserService.executeAdminTopup({
          adminId: ADMIN_ID,
          userId: USER_ACTIVE_ID,
          linkedBankAccountId: BANK_ACC_VALID_ID,
          amount: 500000,
          reason: "Lỗi ghi audit",
          authorizationReference: "TICKET-2026-011",
          adminPassword: ADMIN_PASS,
          idempotencyKey: "idem-fail-audit",
        });
      },
      (err) => {
        assert.match(err.message, /Simulated Database Error/);
        return true;
      }
    );

    // Đảm bảo số dư ví và giao dịch được rollback nguyên vẹn
    assert.strictEqual(dbState.users[USER_ACTIVE_ID].balance, 1000000);
    assert.strictEqual(dbState.transactions.length, 0);
  });

  it("Case 12: Lỗi Socket hoặc Push Notification sau khi DB COMMIT -> vẫn trả 200 OK", async () => {
    socketUtil.emitToUser = () => {
      throw new Error("Socket broken connection");
    };
    firebaseNotification.sendPushNotification = async () => {
      throw new Error("FCM service unavailable");
    };

    const req = {
      params: { id: USER_ACTIVE_ID },
      user: { user_id: ADMIN_ID },
      headers: { "idempotency-key": "idem-socket-err" },
      body: {
        linked_bank_account_id: BANK_ACC_VALID_ID,
        amount: 200000,
        reason: "Lỗi socket sau commit",
        authorization_reference: "TICKET-2026-012",
        admin_password: ADMIN_PASS,
      },
    };

    let responseCode = null;
    let responseBody = null;
    const res = {
      status(code) {
        responseCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await adminUserController.executeAdminTopup(req, res, (err) => {
      assert.fail(`Controller passed error to next(): ${err?.message}`);
    });

    assert.strictEqual(responseCode, 200);
    assert.strictEqual(responseBody.status, "success");
    assert.strictEqual(dbState.users[USER_ACTIVE_ID].balance, 1200000);
  });
});
