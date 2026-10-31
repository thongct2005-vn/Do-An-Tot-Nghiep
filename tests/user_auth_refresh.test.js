const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const authService = require("../src/modules/auth/auth.service");
const authRepository = require("../src/modules/auth/auth.repository");
const pool = require("../src/config/database");

describe("User Auth Service - Refresh Token Status Check Tests", () => {
  const originalFindUserByRefreshToken = authRepository.findUserByRefreshToken;
  const originalUpdateRefeshToken = authRepository.updateRefeshToken;

  after(async () => {
    try {
      await pool.end();
    } catch (_) {}
  });

  beforeEach(() => {
    authRepository.findUserByRefreshToken = originalFindUserByRefreshToken;
    authRepository.updateRefeshToken = originalUpdateRefeshToken;
  });

  it("(a) user ACTIVE: trả về token.access_token và token.refresh_token, updateRefeshToken được gọi đúng 1 lần", async () => {
    let updateCalledTimes = 0;
    let updatedPayload = null;

    authRepository.findUserByRefreshToken = async () => ({
      id: "user-uuid-1",
      phone: "0987654321",
      full_name: "Nguyễn Văn A",
      balance: 100000,
      role: "USER",
      status: "ACTIVE",
    });

    authRepository.updateRefeshToken = async (payload) => {
      updateCalledTimes++;
      updatedPayload = payload;
      return true;
    };

    const result = await authService.refreshToken("valid_token");

    assert.ok(result?.token?.access_token, "Phải có access_token");
    assert.ok(result?.token?.refresh_token, "Phải có refresh_token");
    assert.strictEqual(updateCalledTimes, 1, "updateRefeshToken phải được gọi đúng 1 lần");
    assert.strictEqual(updatedPayload.userId, "user-uuid-1");
    assert.strictEqual(updatedPayload.refreshToken, result.token.refresh_token);
  });

  it("(b) user BLOCKED: reject với statusCode === 403, message 'Tài khoản bị khóa', updateRefeshToken không được gọi", async () => {
    let updateCalled = false;

    authRepository.findUserByRefreshToken = async () => ({
      id: "user-uuid-2",
      phone: "0987654322",
      full_name: "Trần Văn B",
      balance: 50000,
      role: "USER",
      status: "BLOCKED",
    });

    authRepository.updateRefeshToken = async () => {
      updateCalled = true;
    };

    await assert.rejects(
      async () => {
        await authService.refreshToken("token_of_blocked_user");
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.match(err.message, /Tài khoản bị khóa/);
        return true;
      },
    );

    assert.strictEqual(updateCalled, false, "updateRefeshToken không được gọi khi user bị khóa");
  });

  it("(c) repository trả undefined: reject với statusCode === 401 và câu báo cũ", async () => {
    let updateCalled = false;

    authRepository.findUserByRefreshToken = async () => undefined;

    authRepository.updateRefeshToken = async () => {
      updateCalled = true;
    };

    await assert.rejects(
      async () => {
        await authService.refreshToken("token_not_found");
      },
      (err) => {
        assert.strictEqual(err.statusCode, 401);
        assert.match(err.message, /Tài khoản của bạn đã được đăng nhập trên thiết bị khác/);
        return true;
      },
    );

    assert.strictEqual(updateCalled, false, "updateRefeshToken không được gọi khi không tìm thấy token");
  });
});
