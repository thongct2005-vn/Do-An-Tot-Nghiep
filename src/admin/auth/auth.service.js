// auth.service.js: Nghiệp vụ đăng nhập, làm mới phiên, lấy hồ sơ và đăng xuất quản trị viên.
const adminAuthRepository = require("./auth.repository");
const tokenUtil = require("../../utils/auth/jwt");
const { httpError } = require("../../utils/common/http");
const { checkAdminCredentials } = require("./auth.helpers");

const adminAuthService = {
  async login({ email, password }) {
    const user = await checkAdminCredentials(email, password);

    const { accessToken, refreshToken } = tokenUtil.generateAuthTokens({
      id: user.id,
      phone: undefined,
      full_name: user.full_name,
      role: user.role,
    });

    await adminAuthRepository.updateRefreshToken({
      refreshToken,
      userId: user.id,
    });

    return {
      token: {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      admin_info: {
        user_id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    };
  },

  async refreshToken(token) {
    if (!token) {
      throw httpError(401, "Thiếu thông tin xác thực");
    }

    const user = await adminAuthRepository.findAdminByRefreshToken(token);
    if (!user) {
      throw httpError(
        401,
        "Tài khoản của bạn đã được đăng nhập trên thiết bị khác hoặc phiên không hợp lệ",
      );
    }

    if (user.role !== "ADMIN") {
      throw httpError(403, "Tài khoản không có quyền Quản trị viên");
    }

    if (user.status !== "ACTIVE") {
      throw httpError(403, "Tài khoản bị khóa");
    }

    const { accessToken, refreshToken: newRefreshToken } =
      tokenUtil.generateAuthTokens({
        id: user.id,
        phone: undefined,
        full_name: user.full_name,
        role: user.role,
      });

    const rotated = await adminAuthRepository.rotateRefreshToken({
      userId: user.id,
      oldRefreshToken: token,
      newRefreshToken,
    });
    if (!rotated) {
      throw httpError(401, "Phiên đăng nhập đã được thay thế hoặc kết thúc");
    }

    return {
      token: {
        access_token: accessToken,
        refresh_token: newRefreshToken,
      },
    };
  },

  async getMe(adminId) {
    if (!adminId) {
      throw httpError(401, "Thiếu thông tin xác thực");
    }

    const user = await adminAuthRepository.findAdminById(adminId);
    if (!user) {
      throw httpError(404, "Tài khoản không tồn tại");
    }

    if (user.status !== "ACTIVE") {
      throw httpError(403, "Tài khoản bị khóa");
    }

    return {
      admin_info: {
        user_id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    };
  },

  checkAdminCredentials,

  async logout(adminId, refreshToken) {
    if (!adminId || !refreshToken) {
      throw httpError(401, "Thiếu thông tin xác thực");
    }
    await adminAuthRepository.logout(adminId, refreshToken);
  },
};

module.exports = adminAuthService;
