const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert");

process.env.ACCESS_SECRET =
  process.env.ACCESS_SECRET || "test-access-secret-key-32-chars!!";
process.env.REFRESH_SECRET =
  process.env.REFRESH_SECRET || "test-refresh-secret-key-32-chars!";
process.env.OTP_SECRET =
  process.env.OTP_SECRET || "test-otp-secret-key-32-chars!!!!!";
process.env.RESET_SECRET =
  process.env.RESET_SECRET || "test-reset-secret-key-32-chars!!!";

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

  it("(d) user ACTIVE nhưng must_change_password = true: refreshToken bị reject 403", async () => {
    let updateCalled = false;

    authRepository.findUserByRefreshToken = async () => ({
      id: "user-uuid-first-login",
      phone: "0987654399",
      full_name: "Người Dùng Chưa Đổi Mật Khẩu",
      balance: 0,
      role: "USER",
      status: "ACTIVE",
      must_change_password: true,
    });

    authRepository.updateRefeshToken = async () => {
      updateCalled = true;
    };

    await assert.rejects(
      async () => {
        await authService.refreshToken("refresh_before_change_password");
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.match(err.message, /mật khẩu tạm thời/i);
        return true;
      },
    );

    assert.strictEqual(
      updateCalled,
      false,
      "updateRefeshToken không được gọi khi must_change_password = true",
    );
  });
});

describe("User Auth Service - First-Login Enforcement Tests", () => {
  const bcrypt = require("bcrypt");
  const otpService = require("../src/modules/otp/otp.service");
  const originalFindUserByPhone = authRepository.findUserByPhone;
  const originalUpdateRefeshToken = authRepository.updateRefeshToken;
  const originalResetFailedLogin = authRepository.resetFailedLogin;
  const originalVerifyOtp = otpService.verifyOtp;

  beforeEach(() => {
    process.env.ACCESS_SECRET =
      process.env.ACCESS_SECRET || "test-access-secret-key-32-chars!!";
    process.env.REFRESH_SECRET =
      process.env.REFRESH_SECRET || "test-refresh-secret-key-32-chars!";
    process.env.OTP_SECRET =
      process.env.OTP_SECRET || "test-otp-secret-key-32-chars!!!!!";
    authRepository.findUserByPhone = originalFindUserByPhone;
    authRepository.updateRefeshToken = originalUpdateRefeshToken;
    authRepository.resetFailedLogin = originalResetFailedLogin;
    otpService.verifyOtp = originalVerifyOtp;
  });

  after(() => {
    authRepository.findUserByPhone = originalFindUserByPhone;
    authRepository.updateRefeshToken = originalUpdateRefeshToken;
    authRepository.resetFailedLogin = originalResetFailedLogin;
    otpService.verifyOtp = originalVerifyOtp;
  });

  it("verifyLoginOtp: tài khoản must_change_password = false đăng nhập bình thường và cấp tokens", async () => {
    let savedRefresh = false;
    authRepository.findUserByPhone = async () => ({
      id: "user-normal-1",
      phone: "0912000111",
      full_name: "Người Dùng Bình Thường",
      email: "normal@example.vn",
      status: "ACTIVE",
      role: "USER",
      totp_enabled: false,
      must_change_password: false,
    });
    authRepository.updateRefeshToken = async () => {
      savedRefresh = true;
    };
    otpService.verifyOtp = async () => true;

    const result = await authService.verifyLoginOtp({
      userId: "user-normal-1",
      phone: "0912000111",
      otp: "123456",
    });

    assert.ok(result.token?.access_token);
    assert.ok(result.token?.refresh_token);
    assert.strictEqual(result.must_change_password, undefined);
    assert.strictEqual(savedRefresh, true);
  });

  it("verifyLoginOtp: tài khoản must_change_password = true bị giữ ở bước đổi mật khẩu, không cấp tokens", async () => {
    let savedRefresh = false;
    authRepository.findUserByPhone = async () => ({
      id: "user-temp-1",
      phone: "0912000222",
      full_name: "Người Dùng Tạo Bởi Admin",
      email: "admin-created@example.vn",
      password_hash: "temp-hash-abc",
      status: "ACTIVE",
      role: "USER",
      totp_enabled: false,
      must_change_password: true,
    });
    authRepository.updateRefeshToken = async () => {
      savedRefresh = true;
    };
    otpService.verifyOtp = async () => true;

    const result = await authService.verifyLoginOtp({
      userId: "user-temp-1",
      phone: "0912000222",
      otp: "123456",
    });

    assert.strictEqual(result.must_change_password, true);
    assert.ok(result.change_password_token);
    assert.strictEqual(result.token, undefined);
    assert.strictEqual(savedRefresh, false);
    assert.deepStrictEqual(result.user_info, {
      user_id: "user-temp-1",
      phone: "0912000222",
      full_name: "Người Dùng Tạo Bởi Admin",
    });
  });

  it("setupTotp bị chặn 403 khi user.must_change_password === true", async () => {
    const tempHash = await bcrypt.hash("482910", 10);
    authRepository.findUserByPhone = async () => ({
      id: "user-temp-totp",
      phone: "0912000333",
      full_name: "User Temp TOTP",
      email: "temp-totp@example.vn",
      password_hash: tempHash,
      status: "ACTIVE",
      role: "USER",
      totp_enabled: false,
      must_change_password: true,
      locked_until: null,
      is_locked: false,
    });
    authRepository.resetFailedLogin = async () => {};

    await assert.rejects(
      async () => {
        await authService.setupTotp({
          phone: "0912000333",
          password: "482910",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.match(err.message, /mật khẩu tạm thời/i);
        return true;
      },
    );
  });
});
