const { successResponse } = require("../../utils/apiResponse");
const adminUserService = require("./user.service");

const adminUserController = {
  async getStats(req, res, next) {
    try {
      const result = await adminUserService.getStats();
      return successResponse(
        res,
        200,
        "Lấy thống kê người dùng thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getUsers(req, res, next) {
    try {
      const { page, limit, search, status } = req.query;
      const result = await adminUserService.getUsers({
        page,
        limit,
        search,
        status,
      });
      return successResponse(
        res,
        200,
        "Lấy danh sách người dùng thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getUserDetail(req, res, next) {
    try {
      const { id } = req.params;
      const result = await adminUserService.getUserDetail(id);
      return successResponse(
        res,
        200,
        "Lấy chi tiết người dùng thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async updateUserStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;
      const result = await adminUserService.updateUserStatus({
        userId: id,
        status,
        reason,
      });
      return successResponse(
        res,
        200,
        status === "ACTIVE"
          ? "Mở khóa tài khoản người dùng thành công"
          : "Khóa tài khoản người dùng thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminUserController;
