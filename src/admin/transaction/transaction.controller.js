// transaction.controller.js: Controller quản trị danh sách, chi tiết, tra soát, xuất báo cáo và hoàn tiền giao dịch Admin.
const { successResponse, httpError } = require("../../utils/common/http");
const adminTransactionService = require("./transaction.service");
const { sendXlsxResponse } = require("./transaction.export");
const {
  buildTransactionReceiptPdf,
  sendReceiptPdfResponse,
} = require("./transaction.receipt");
const socketUtil = require("../../utils/notifications/socket");
const firebaseNotification = require("../../utils/notifications/firebaseNotification");
const {
  extractAdminIdempotencyKey,
  emitSocketSafe,
  sendPushSafe,
} = require("../shared/adminHelpers");
const { REVERSE_BODY_ALLOWLIST } = require("./transaction.helpers");

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

  async exportTransactionReceiptPdf(req, res, next) {
    try {
      const { id } = req.params;
      const detail = await adminTransactionService.getTransactionDetail(id);
      const adminName =
        req.user?.full_name || req.user?.email || "Quản trị viên";
      const buffer = await buildTransactionReceiptPdf({ detail, adminName });
      return sendReceiptPdfResponse(res, { buffer, txId: detail.id });
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
      const idempotencyKey = extractAdminIdempotencyKey(req);

      const outcome = await adminTransactionService.reverseTransaction({
        transactionId: id,
        adminId,
        reason: body.reason,
        adminPassword: body.admin_password,
        idempotencyKey,
      });

      if (!outcome.replayed && outcome.notificationContext) {
        const ctx = outcome.notificationContext;

        await emitSocketSafe(
          () =>
            socketUtil.emitToUser(ctx.debitedUserId, "wallet_balance_updated", {
              balance: ctx.debitedBalanceAfter,
              transactionId: ctx.reversalTransactionId,
              originalTransactionId: ctx.originalTransactionId,
              type: "REVERSAL_DEBIT",
            }),
          "wallet_balance_updated (reversal debited)",
        );

        if (Number(ctx.creditedToMainWallet || 0) > 0) {
          await emitSocketSafe(
            () =>
              socketUtil.emitToUser(ctx.refundedUserId, "wallet_balance_updated", {
                balance: ctx.refundedBalanceAfter,
                transactionId:
                  ctx.excessTransactionId || ctx.reversalTransactionId,
                originalTransactionId: ctx.originalTransactionId,
                type: "REVERSAL_REFUND",
              }),
            "wallet_balance_updated (reversal refunded)",
          );
        }

        await sendPushSafe(
          () =>
            firebaseNotification.sendPushNotification(ctx.debitedUserId, {
              title: "Biến động số dư (Hoàn tiền đơn hàng Merchant)",
              body: `Ví Merchant của bạn vừa được khấu trừ -${Number(ctx.amount).toLocaleString("vi-VN")}đ để hoàn trả giao dịch ${ctx.originalTransactionId}`,
              data: {
                type: "ADMIN_OP_REVERSAL_DEBIT",
                transactionId: String(ctx.reversalTransactionId),
                originalTransactionId: String(ctx.originalTransactionId),
                originalFundingSource: String(ctx.originalFundingSource || ""),
                balance: String(ctx.debitedBalanceAfter),
              },
            }),
          "reversal debited",
        );

        let customerTitle = "Hoàn tiền thanh toán thành công";
        let customerBody = `Bạn đã được hoàn +${Number(ctx.amount).toLocaleString("vi-VN")}đ vào Ví chính từ giao dịch thanh toán Merchant ${ctx.originalTransactionId}`;
        if (ctx.originalFundingSource === "POSTPAID") {
          customerTitle = "Hoàn tiền giao dịch Ví trả sau thành công";
          const totalFmt = Number(ctx.amount).toLocaleString("vi-VN");
          const postpaidFmt = Number(ctx.creditedToPostpaid || 0).toLocaleString("vi-VN");
          const excessFmt = Number(ctx.creditedToMainWallet || 0).toLocaleString("vi-VN");
          if (Number(ctx.creditedToPostpaid || 0) > 0 && Number(ctx.creditedToMainWallet || 0) > 0) {
            customerBody = `Giao dịch ${ctx.originalTransactionId} đã được hoàn ${totalFmt}đ (giảm ${postpaidFmt}đ dư nợ Ví trả sau và cộng ${excessFmt}đ vào Ví chính)`;
          } else if (Number(ctx.creditedToPostpaid || 0) > 0) {
            customerBody = `Giao dịch ${ctx.originalTransactionId} đã được hoàn ${totalFmt}đ để giảm dư nợ Ví trả sau của bạn`;
          } else {
            customerBody = `Bạn đã được hoàn +${totalFmt}đ vào Ví chính từ giao dịch Ví trả sau ${ctx.originalTransactionId}`;
          }
        } else if (ctx.originalFundingSource === "BANK") {
          customerBody = `Bạn đã được hoàn +${Number(ctx.amount).toLocaleString("vi-VN")}đ vào Ví chính Mio từ giao dịch thanh toán Merchant ${ctx.originalTransactionId}`;
        }

        await sendPushSafe(
          () =>
            firebaseNotification.sendPushNotification(ctx.refundedUserId, {
              title: customerTitle,
              body: customerBody,
              data: {
                type: "ADMIN_OP_REVERSAL_REFUND",
                transactionId: String(ctx.excessTransactionId || ctx.reversalTransactionId),
                originalTransactionId: String(ctx.originalTransactionId),
                originalFundingSource: String(ctx.originalFundingSource || ""),
                creditedToPostpaid: String(ctx.creditedToPostpaid || 0),
                creditedToMainWallet: String(ctx.creditedToMainWallet || 0),
                balance: String(ctx.refundedBalanceAfter),
              },
            }),
          "reversal refunded",
        );
      }

      return successResponse(
        res,
        200,
        "Hoàn tiền giao dịch Merchant thành công",
        outcome.data
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminTransactionController;

