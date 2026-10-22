const { successResponse } = require("../../../../utils/apiResponse");
const merchantTransactionService = require("./transaction.service");
const { emitToUser } = require("../../../../utils/socket");
const { sendPushNotification } = require("../../../../utils/fireBaseNotification");
const merchantTransactionController = {
  async transferMoney(req, res, next) {
    try {
      const idempotencyKey = req.idempotencyKey;
      const { user_id: sourceUserId } = req.user;
      const {
        destination_user_id: destinationUserId,
        amount,
        description,
      } = req.body;
      const result = await merchantTransactionService.transferMoney({
        sourceUserId,
        destinationUserId,
        amount,
        description,
        idempotencyKey,
      });
      emitToUser(sourceUserId, "wallet_balance_updated", {
        balance: result.sourceBalanceAfter,
        transactionId: result.transactionId,
        type: "SEND",
      });

      emitToUser(destinationUserId, "wallet_balance_updated", {
        balance: result.destBalanceAfter,
        transactionId: result.transactionId,
        type: "RECEIVE",
        fromUserName: result.sourceUserName,
      });
      sendPushNotification(sourceUserId, {
        title: "Chuyển tiền thành công",
        body: `Bạn vừa chuyển -${Number(result.amount).toLocaleString("vi-VN")}đ cho ${result.destinationUserName}`,
        data: {
          type: "SEND_MONEY",
          transactionId: result.transactionId,
          balance: result.sourceBalanceAfter,
        },
      });

      sendPushNotification(destinationUserId, {
        title: "Nhận tiền thành công",
        body: `Bạn vừa nhận +${Number(result.amount).toLocaleString("vi-VN")}đ từ ${result.sourceUserName}\nNội dung: ${description}`,
        data: {
          type: "RECEIVE_MONEY",
          transactionId: result.transactionId,
          balance: result.destBalanceAfter,
        },
      });
      return successResponse(res, 200, "Chuyển tiền thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async topupMoney(req, res, next) {
    try {
      const { user_id: sourceUserId } = req.user;
      const idempotencyKey = req.idempotencyKey;
      const { linked_bank_account_id: linkedBankAccountId, amount } = req.body;
      const result = await merchantTransactionService.topupMoney({
        sourceUserId,
        amount,
        idempotencyKey,
        linkedBankAccountId,
      });

      emitToUser(sourceUserId, "wallet_balance_updated", {
        balance: result.sourceBalanceAfter,
        transactionId: result.transactionId,
        type: "TOPUP",
      });

      sendPushNotification(sourceUserId, {
        title: `Nạp tiền thành công từ ${result.bankName}`,
        body: `Bạn đã nạp +${Number(result.amount).toLocaleString("vi-VN")}đ vào tài khoản`,
        data: {
          type: "TOPUP_MONEY",
          transactionId: result.transactionId,
          balance: result.sourceBalanceAfter,
        },
      });

      return successResponse(res, 200, "Nạp tiền thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async withdrawnMoney(req, res, next) {
    try {
      const { user_id: sourceUserId } = req.user;
      const idempotencyKey = req.idempotencyKey;
      const { linked_bank_account_id: linkedBankAccountId, amount } = req.body;
      const result = await merchantTransactionService.withdrawnMoney({
        sourceUserId,
        amount,
        idempotencyKey,
        linkedBankAccountId,
      });

      emitToUser(sourceUserId, "wallet_balance_updated", {
        balance: result.sourceBalanceAfter,
        transactionId: result.transactionId,
        type: "WITHDRAW",
      });

      sendPushNotification(sourceUserId, {
        title: `Rút tiền thành công`,
        body: `Bạn đã rút -${Number(result.amount).toLocaleString("vi-VN")}đ về ngân hàng ${result.bankName}`,
        data: {
          type: "WITHDRAW_MONEY",
          transactionId: result.transactionId,
          balance: result.sourceBalanceAfter,
        },
      });

      return successResponse(res, 200, "Rút tiền thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async processQRPayment(req, res, next) {
    try {
      const idempotencyKey = req.idempotencyKey;
      const { user_id: sourceUserId } = req.user;
      const { reference_code: referenceCode } = req.body;

      const result = await merchantTransactionService.processQRPayment({
        sourceUserId,
        idempotencyKey,
        referenceCode,
      });

      emitToUser(sourceUserId, "wallet_balance_updated", {
        balance: result.sourceBalanceAfter,
        transactionId: result.transactionId,
        type: "SEND",
      });

      emitToUser(result.destinationId, "wallet_balance_updated", {
        balance: result.destBalanceAfter,
        transactionId: result.transactionId,
        type: "RECEIVE",
        fromUserName: result.sourceUserName,
      });

      sendPushNotification(sourceUserId, {
        title: "Thanh toán QR thành công",
        body: `Bạn vừa thanh toán -${Number(result.amount).toLocaleString("vi-VN")}đ cho ${result.destinationUserName}`,
        data: {
          type: "SEND_MONEY",
          transactionId: result.transactionId,
          balance: result.sourceBalanceAfter,
        },
      });

      sendPushNotification(result.destinationId, {
        title: "Nhận tiền thành công",
        body: `Bạn vừa nhận +${Number(result.amount).toLocaleString("vi-VN")}đ từ ${result.sourceUserName}`,
        data: {
          type: "RECEIVE_MONEY",
          transactionId: result.transactionId,
          balance: result.destBalanceAfter,
        },
      });

      return successResponse(res, 200, "Thanh toán QR thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async getTransferHistory(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const {
        cursor_id: cursorId,
        limit,
        keyword,
        type,
        start_date: startDate,
        end_date: endDate,
      } = req.query;

      const result = await merchantTransactionService.getTransferHistory(userId, {
        cursorId,
        limit,
        keyword,
        type,
        startDate,
        endDate,
      });

      return successResponse(
        res,
        200,
        "Lấy danh sách lịch sử thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async getTransactionDetail(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { transactionId } = req.params;

      const result = await merchantTransactionService.getTransactionDetail(
        userId,
        transactionId,
      );

      return successResponse(
        res,
        200,
        "Lấy chi tiết giao dịch thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async getCurrentMonthSummary(req, res, next) {
    try {
      const { user_id: userId } = req.user;

      const result = await merchantTransactionService.getCurrentMonthSummary(userId);
      return successResponse(
        res,
        200,
        "Lấy tổng quan giao dịch thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async getMerchantStats(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { start_date: startDate, end_date: endDate } = req.query;

      const result = await merchantTransactionService.getMerchantStats(userId, {
        startDate,
        endDate,
      });

      return successResponse(
        res,
        200,
        "Lấy số liệu thống kê thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = merchantTransactionController;