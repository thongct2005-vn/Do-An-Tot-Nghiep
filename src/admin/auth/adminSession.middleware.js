const adminAuthRepository = require("./auth.repository");
const tokenUtil = require("../../utils/jwt");
const { httpError } = require("../../utils/httpError");

async function requireCurrentAdminSession(req, res, next) {
  try {
    const adminId = req.user?.user_id;
    const sessionId = req.user?.sid;
    if (!adminId || !sessionId) {
      throw httpError(401, "Phiên đăng nhập không hợp lệ");
    }

    const admin = await adminAuthRepository.findAdminSessionById(adminId);
    if (!admin) {
      throw httpError(401, "Phiên đăng nhập không hợp lệ");
    }
    if (admin.status !== "ACTIVE") {
      throw httpError(403, "Tài khoản bị khóa");
    }
    if (
      !admin.refresh_token ||
      sessionId !== tokenUtil.getSessionId(admin.refresh_token)
    ) {
      throw httpError(401, "Phiên đăng nhập đã được thay thế hoặc kết thúc");
    }
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = requireCurrentAdminSession;
