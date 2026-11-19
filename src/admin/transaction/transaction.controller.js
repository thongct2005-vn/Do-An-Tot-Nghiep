const { successResponse } = require("../../utils/apiResponse");
const { httpError } = require("../../utils/httpError");
const adminTransactionService = require("./transaction.service");
const { sendXlsxResponse } = require("./transaction.export");
const postpaidService = require("../../modules/postpaid/postpaid.service");
const socketUtil = require("../../utils/socket");
const firebaseNotification = require("../../utils/firebaseNotification");

const REVERSE_BODY_ALLOWLIST = new Set(["reason", "admin_password"]);

const adminTransactionController = {
  async exportTransactions(req, res, next) {
    try {
      const {
        type,
        status,
        initiated_by,
        anomaly,
        keyword,
        period,
        start_date,
        end_date,
      } = req.query;

      const { buffer, fileName } =
        await adminTransactionService.exportTransactions({
          type,
          status,
          initiated_by,
          anomaly,
          keyword,
          period,
          start_date,
          end_date,
          currentUser: req.user,
        });

      return sendXlsxResponse(res, { buffer, fileName });
    } catch (e) {
      next(e);
    }
  },

  async getTransactions(req, res, next) {
    try {
      const {
        page,
        limit,
        type,
        status,
        initiated_by,
        anomaly,
        keyword,
        period,
        start_date,
        end_date,
      } = req.query;

      const result = await adminTransactionService.getTransactions({
        page,
        limit,
        type,
        status,
        initiated_by,
        anomaly,
        keyword,
        period,
        start_date,
        end_date,
      });

      return successResponse(
        res,
        200,
        "Lấy danh sách giao dịch thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getTransactionDetail(req, res, next) {
    try {
      const { id } = req.params;
      const result = await adminTransactionService.getTransactionDetail(id);

      return successResponse(
        res,
        200,
        "Lấy chi tiết giao dịch thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async openDispute(req, res, next) {
    try {
      const { id } = req.params;
      const {
        dispute_type,
        disputeType,
        reason,
        authorization_reference,
        authorizationReference,
        note,
      } = req.body;

      const result = await adminTransactionService.openDispute(id, {
        disputeType: dispute_type || disputeType,
        reason,
        authorizationReference:
          authorization_reference || authorizationReference,
        note,
        currentUser: req.user,
      });

      return successResponse(
        res,
        201,
        "Mở hồ sơ tra soát thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async appendDisputeEvent(req, res, next) {
    try {
      const { id, disputeId } = req.params;
      const {
        action,
        dispute_status,
        disputeStatus,
        resolution_result,
        resolutionResult,
        reason,
        note,
      } = req.body;

      const result = await adminTransactionService.appendDisputeEvent(
        id,
        disputeId,
        {
          action,
          disputeStatus: dispute_status || disputeStatus,
          resolutionResult: resolution_result || resolutionResult,
          reason,
          note,
          currentUser: req.user,
        }
      );

      return successResponse(
        res,
        200,
        "Cập nhật hồ sơ tra soát thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async refundPostpaid(req, res, next) {
    try {
      const { id } = req.params;
      const { amount, reason } = req.body || {};
      const actorId = req.user?.user_id || req.user?.id || null;
      const idempotencyKey = req.headers["idempotency-key"] || null;

      const result = await postpaidService.refundPostpaidTransaction({
        originalTxId: id,
        refundAmount: amount ?? null,
        reason: reason || "",
        actorId,
        idempotencyKey,
      });

      return successResponse(
        res,
        200,
        "Hoàn tiền giao dịch Ví trả sau thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async reverseTransaction(req, res, next) {
    try {
      const { id } = req.params;
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw httpError(400, "Dữ liệu yêu cầu hoàn tiền không hợp lệ");
      }

      const bodyKeys = Object.keys(body);
      const unexpectedKey = bodyKeys.find((k) => !REVERSE_BODY_ALLOWLIST.has(k));
      if (unexpectedKey) {
        if (
          unexpectedKey === "authorization_reference" ||
          unexpectedKey === "authorizationReference"
        ) {
          throw httpError(
            400,
            "Nghiệp vụ hoàn tiền không chấp nhận trường authorization_reference"
          );
        }
        throw httpError(
          400,
          `Payload chứa trường không được phép: ${unexpectedKey}`
        );
      }

      const adminId = req.user?.user_id || req.user?.id || null;
      const idempotencyKey =
        req.headers?.["idempotency-key"] ||
        req.headers?.["Idempotency-Key"] ||
        req.idempotencyKey;

      const outcome = await adminTransactionService.reverseTransaction({
        transactionId: id,
        adminId,
        reason: body.reason,
        adminPassword: body.admin_password,
        idempotencyKey,
      });

      if (!outcome.replayed && outcome.notificationContext) {
        const ctx = outcome.notificationContext;

        try {
          socketUtil.emitToUser(ctx.debitedUserId, "wallet_balance_updated", {
            balance: ctx.debitedBalanceAfter,
            transactionId: ctx.reversalTransactionId,
            originalTransactionId: ctx.originalTransactionId,
            type: "REVERSAL_DEBIT",
          });
        } catch (socketErr) {
          console.error(
            "Emit wallet_balance_updated (reversal debited) error:",
            socketErr.message
          );
        }

        try {
          socketUtil.emitToUser(ctx.refundedUserId, "wallet_balance_updated", {
            balance: ctx.refundedBalanceAfter,
            transactionId: ctx.reversalTransactionId,
            originalTransactionId: ctx.originalTransactionId,
            type: "REVERSAL_REFUND",
          });
        } catch (socketErr) {
          console.error(
            "Emit wallet_balance_updated (reversal refunded) error:",
            socketErr.message
          );
        }

        try {
          await firebaseNotification.sendPushNotification(ctx.debitedUserId, {
            title: "Biến động số dư (Hoàn tiền giao dịch)",
            body: `Ví của bạn vừa được khấu trừ -${Number(ctx.amount).toLocaleString("vi-VN")}đ để hoàn trả giao dịch ${ctx.originalTransactionId}`,
            data: {
              type: "ADMIN_OP_REVERSAL_DEBIT",
              transactionId: String(ctx.reversalTransactionId),
              originalTransactionId: String(ctx.originalTransactionId),
              balance: String(ctx.debitedBalanceAfter),
            },
          });
        } catch (fcmErr) {
          console.error("Push notification (reversal debited) error:", fcmErr.message);
        }

        try {
          await firebaseNotification.sendPushNotification(ctx.refundedUserId, {
            title: "Hoàn tiền giao dịch thành công",
            body: `Bạn đã được hoàn +${Number(ctx.amount).toLocaleString("vi-VN")}đ từ giao dịch ${ctx.originalTransactionId}`,
            data: {
              type: "ADMIN_OP_REVERSAL_REFUND",
              transactionId: String(ctx.reversalTransactionId),
              originalTransactionId: String(ctx.originalTransactionId),
              balance: String(ctx.refundedBalanceAfter),
            },
          });
        } catch (fcmErr) {
          console.error("Push notification (reversal refunded) error:", fcmErr.message);
        }
      }

      return successResponse(
        res,
        200,
        "Hoàn tiền giao dịch P2P thành công",
        outcome.data
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminTransactionController;

