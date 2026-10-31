const { successResponse } = require("../../utils/apiResponse");
const adminUserService = require("./user.service");
const socketUtil = require("../../utils/socket");
const firebaseNotification = require("../../utils/fireBaseNotification");

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
      const adminId = req.user.user_id;
      const result = await adminUserService.updateUserStatus({
        adminId,
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

  async getUserTransactions(req, res, next) {
    try {
      const { id } = req.params;
      const { page, limit, period, start_date, end_date, keyword } = req.query;
      const result = await adminUserService.getUserTransactions({
        userId: id,
        page,
        limit,
        period,
        startDate: start_date,
        endDate: end_date,
        keyword,
      });
      return successResponse(
        res,
        200,
        "Lấy danh sách giao dịch người dùng thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async updateUserProfile(req, res, next) {
    try {
      const { id } = req.params;
      const { full_name, phone, email, reason } = req.body;
      const adminId = req.user.user_id;
      const result = await adminUserService.updateUserProfile({
        adminId,
        userId: id,
        fullName: full_name,
        phone,
        email,
        reason,
      });
      return successResponse(
        res,
        200,
        "Cập nhật thông tin người dùng thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getUserChangeHistory(req, res, next) {
    try {
      const { id } = req.params;
      const { page, limit } = req.query;
      const result = await adminUserService.getUserChangeHistory({
        userId: id,
        page,
        limit,
      });
      return successResponse(
        res,
        200,
        "Lấy lịch sử thay đổi người dùng thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async executeAdminP2P(req, res, next) {
    try {
      const { id: sourceUserId } = req.params;
      const adminId = req.user?.user_id;
      const idempotencyKey =
        req.headers?.["idempotency-key"] ||
        req.headers?.["Idempotency-Key"] ||
        req.idempotencyKey;

      const {
        destination_user_id: destinationUserId,
        amount,
        description,
        reason,
        authorization_reference: authorizationReference,
        admin_password: adminPassword,
      } = req.body || {};

      const outcome = await adminUserService.executeAdminP2P({
        adminId,
        sourceUserId,
        destinationUserId,
        amount,
        description,
        reason,
        authorizationReference,
        adminPassword,
        idempotencyKey,
      });

      if (!outcome.replayed && outcome.notificationContext) {
        const ctx = outcome.notificationContext;

        try {
          socketUtil.emitToUser(ctx.sourceUserId, "wallet_balance_updated", {
            balance: ctx.sourceBalanceAfter,
            transactionId: ctx.transactionId,
            type: "SEND",
          });
        } catch (socketErr) {
          console.error(
            "Emit wallet_balance_updated (source) error:",
            socketErr.message
          );
        }

        try {
          socketUtil.emitToUser(
            ctx.destinationUserId,
            "wallet_balance_updated",
            {
              balance: ctx.destBalanceAfter,
              transactionId: ctx.transactionId,
              type: "RECEIVE",
              fromUserName: ctx.sourceUserName,
            }
          );
        } catch (socketErr) {
          console.error(
            "Emit wallet_balance_updated (dest) error:",
            socketErr.message
          );
        }

        try {
          await firebaseNotification.sendPushNotification(ctx.sourceUserId, {
            title: "Biến động số dư (Hỗ trợ Quản trị viên)",
            body: `Ví của bạn vừa chuyển -${Number(ctx.amount).toLocaleString("vi-VN")}đ cho ${ctx.destinationUserName}`,
            data: {
              type: "SEND_MONEY",
              transactionId: ctx.transactionId,
              balance: ctx.sourceBalanceAfter,
            },
          });
        } catch (fcmErr) {
          console.error("Push notification (source) error:", fcmErr.message);
        }

        try {
          await firebaseNotification.sendPushNotification(
            ctx.destinationUserId,
            {
              title: "Nhận tiền thành công",
              body: `Bạn vừa nhận +${Number(ctx.amount).toLocaleString("vi-VN")}đ từ ${ctx.sourceUserName}\nNội dung: ${ctx.description || ""}`,
              data: {
                type: "RECEIVE_MONEY",
                transactionId: ctx.transactionId,
                balance: ctx.destBalanceAfter,
              },
            }
          );
        } catch (fcmErr) {
          console.error("Push notification (dest) error:", fcmErr.message);
        }
      }

      return successResponse(
        res,
        200,
        "Thực hiện chuyển tiền P2P thành công",
        outcome.data
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminUserController;
