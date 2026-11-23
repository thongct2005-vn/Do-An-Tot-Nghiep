const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const adminAuthService = require("../src/admin/auth/auth.service");
const adminAuthRepository = require("../src/admin/auth/auth.repository");
const tokenUtil = require("../src/utils/auth/jwt");

describe("Admin Auth Service - Session Maintenance Tests", () => {
  const originalFindRefreshToken = adminAuthRepository.findAdminByRefreshToken;
  const originalUpdateRefreshToken = adminAuthRepository.updateRefreshToken;
  const originalRotateRefreshToken = adminAuthRepository.rotateRefreshToken;
  const originalFindAdminById = adminAuthRepository.findAdminById;
  const originalLogout = adminAuthRepository.logout;

  // Restore mocks after each test
  beforeEach(() => {
    adminAuthRepository.findAdminByRefreshToken = originalFindRefreshToken;
    adminAuthRepository.updateRefreshToken = originalUpdateRefreshToken;
    adminAuthRepository.rotateRefreshToken = originalRotateRefreshToken;
    adminAuthRepository.findAdminById = originalFindAdminById;
    adminAuthRepository.logout = originalLogout;
  });

  describe("POST /refresh-token logic (adminAuthService.refreshToken)", () => {
    it("nên ném lỗi 401 nếu thiếu refresh token", async () => {
      await assert.rejects(
        async () => {
          await adminAuthService.refreshToken(null);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 401);
          assert.match(err.message, /Thiếu thông tin xác thực/);
          return true;
        },
      );
    });

    it("nên ném lỗi 401 nếu refresh token không khớp trong DB (đã bị thu hồi hoặc đổi nơi khác)", async () => {
      adminAuthRepository.findAdminByRefreshToken = async () => null;

      await assert.rejects(
        async () => {
          await adminAuthService.refreshToken("invalid_or_revoked_token");
        },
        (err) => {
          assert.strictEqual(err.statusCode, 401);
          assert.match(err.message, /đăng nhập trên thiết bị khác/);
          return true;
        },
      );
    });

    it("nên ném lỗi 403 nếu tài khoản không phải là Quản trị viên (ADMIN)", async () => {
      adminAuthRepository.findAdminByRefreshToken = async () => ({
        id: "user-123",
        email: "user@example.com",
        role: "USER",
        status: "ACTIVE",
      });

      await assert.rejects(
        async () => {
          await adminAuthService.refreshToken("valid_token_but_wrong_role");
        },
        (err) => {
          assert.strictEqual(err.statusCode, 403);
          assert.match(err.message, /không có quyền Quản trị viên/);
          return true;
        },
      );
    });

    it("nên ném lỗi 403 nếu tài khoản Admin đang bị khóa (status != ACTIVE)", async () => {
      adminAuthRepository.findAdminByRefreshToken = async () => ({
        id: "admin-123",
        email: "admin@example.com",
        role: "ADMIN",
        status: "LOCKED",
      });

      await assert.rejects(
        async () => {
          await adminAuthService.refreshToken("valid_token_locked_account");
        },
        (err) => {
          assert.strictEqual(err.statusCode, 403);
          assert.match(err.message, /Tài khoản bị khóa/);
          return true;
        },
      );
    });

    it("nên cấp cặp token mới (Token Rotation) và cập nhật DB khi refresh token hợp lệ", async () => {
      let rotatedPayload = null;

      adminAuthRepository.findAdminByRefreshToken = async (token) => {
        if (token === "valid_refresh_token") {
          return {
            id: "admin-uuid-1",
            email: "admin@system.com",
            full_name: "Admin Tổng",
            role: "ADMIN",
            status: "ACTIVE",
          };
        }
        return null;
      };

      adminAuthRepository.rotateRefreshToken = async (payload) => {
        rotatedPayload = payload;
        return true;
      };

      const result = await adminAuthService.refreshToken("valid_refresh_token");

      assert.ok(result.token, "Kết quả phải chứa object token");
      assert.ok(result.token.access_token, "Phải có access_token mới");
      assert.ok(result.token.refresh_token, "Phải có refresh_token mới");
      assert.strictEqual(rotatedPayload?.userId, "admin-uuid-1");
      assert.strictEqual(rotatedPayload?.oldRefreshToken, "valid_refresh_token");
      assert.strictEqual(
        rotatedPayload?.newRefreshToken,
        result.token.refresh_token,
        "Token lưu vào DB phải là token mới (rotation)",
      );

      // Kiểm tra access token decode không chứa phone
      const decodedAccess = tokenUtil.verifyAccessToken(result.token.access_token);
      assert.strictEqual(decodedAccess.user_id, "admin-uuid-1");
      assert.strictEqual(decodedAccess.type, "ADMIN");
      assert.strictEqual(decodedAccess.phone, undefined, "Access token không được chứa phone");
    });

    it("nên ném lỗi 401 nếu rotateRefreshToken trả false (xung đột phiên đồng thời)", async () => {
      adminAuthRepository.findAdminByRefreshToken = async () => ({
        id: "admin-uuid-1",
        email: "admin@system.com",
        full_name: "Admin Tổng",
        role: "ADMIN",
        status: "ACTIVE",
      });
      adminAuthRepository.rotateRefreshToken = async () => false;

      await assert.rejects(
        async () => {
          await adminAuthService.refreshToken("race_refresh_token");
        },
        (err) => {
          assert.strictEqual(err.statusCode, 401);
          assert.match(err.message, /thay thế hoặc kết thúc/);
          return true;
        },
      );
    });
  });

  describe("GET /me logic (adminAuthService.getMe)", () => {
    it("nên ném lỗi 401 nếu thiếu adminId", async () => {
      await assert.rejects(
        async () => {
          await adminAuthService.getMe(null);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 401);
          return true;
        },
      );
    });

    it("nên ném lỗi 404 nếu không tìm thấy Admin", async () => {
      adminAuthRepository.findAdminById = async () => null;

      await assert.rejects(
        async () => {
          await adminAuthService.getMe("non_existent_id");
        },
        (err) => {
          assert.strictEqual(err.statusCode, 404);
          return true;
        },
      );
    });

    it("nên ném lỗi 403 nếu tài khoản Admin bị khóa", async () => {
      adminAuthRepository.findAdminById = async () => ({
        id: "admin-123",
        email: "admin@test.com",
        role: "ADMIN",
        status: "BLOCKED",
      });

      await assert.rejects(
        async () => {
          await adminAuthService.getMe("admin-123");
        },
        (err) => {
          assert.strictEqual(err.statusCode, 403);
          assert.match(err.message, /Tài khoản bị khóa/);
          return true;
        },
      );
    });

    it("nên trả về thông tin Quản trị viên an toàn và KHÔNG chứa trường phone", async () => {
      adminAuthRepository.findAdminById = async () => ({
        id: "admin-uuid-safe",
        email: "rootadmin@bank.com",
        full_name: "Super Admin",
        role: "ADMIN",
        status: "ACTIVE",
      });

      const result = await adminAuthService.getMe("admin-uuid-safe");
      assert.ok(result.admin_info);
      assert.strictEqual(result.admin_info.user_id, "admin-uuid-safe");
      assert.strictEqual(result.admin_info.email, "rootadmin@bank.com");
      assert.strictEqual(result.admin_info.full_name, "Super Admin");
      assert.strictEqual(result.admin_info.role, "ADMIN");
      assert.strictEqual(result.admin_info.phone, undefined, "Tuyệt đối không được chứa phone");
      assert.strictEqual(result.admin_info.password_hash, undefined, "Không được chứa password_hash");
    });
  });

  describe("POST /logout logic (adminAuthService.logout)", () => {
    it("nên ném lỗi 401 nếu thiếu adminId hoặc refreshToken", async () => {
      await assert.rejects(
        async () => {
          await adminAuthService.logout(null, "rt-1");
        },
        (err) => {
          assert.strictEqual(err.statusCode, 401);
          assert.match(err.message, /Thiếu thông tin xác thực/);
          return true;
        },
      );

      await assert.rejects(
        async () => {
          await adminAuthService.logout("admin-1", "");
        },
        (err) => {
          assert.strictEqual(err.statusCode, 401);
          assert.match(err.message, /Thiếu thông tin xác thực/);
          return true;
        },
      );
    });

    it("nên gọi repository với đúng adminId và refreshToken khi đăng xuất", async () => {
      let loggedOutId = null;
      let loggedOutToken = null;
      adminAuthRepository.logout = async (adminId, refreshToken) => {
        loggedOutId = adminId;
        loggedOutToken = refreshToken;
      };

      await adminAuthService.logout("admin-to-logout-123", "rt-current-123");
      assert.strictEqual(loggedOutId, "admin-to-logout-123", "Repository logout phải được gọi với đúng ID");
      assert.strictEqual(loggedOutToken, "rt-current-123", "Repository logout phải được gọi với đúng refreshToken");
    });
  });
});
