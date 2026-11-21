const { successResponse } = require("../../utils/apiResponse");
const { emitToUser } = require("../../utils/socket");
const { sendPushNotification } = require("../../utils/firebaseNotification");
const { removeUploadedProofFiles } = require("../../utils/postpaidProofImage");
const postpaidService = require("./postpaid.service");

const postpaidController = {
  async getInfo(req, res, next) {
    try {
      const data = await postpaidService.getWalletInfo();
      return successResponse(
        res,
        200,
        "Lấy thông tin quy định Ví trả sau thành công",
        data,
      );
    } catch (e) {
      next(e);
    }
  },

  async getWallet(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const data = await postpaidService.getWalletOverview(userId);
      return successResponse(
        res,
        200,
        "Lấy thông tin Ví trả sau thành công",
        data,
      );
    } catch (e) {
      next(e);
    }
  },

  async activate(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const data = await postpaidService.activateWallet(userId);
      return successResponse(
        res,
        201,
        "Kích hoạt Ví trả sau thành công",
        data,
      );
    } catch (e) {
      next(e);
    }
  },

  async freeze(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const data = await postpaidService.freezeWallet(userId);
      return successResponse(
        res,
        200,
        "Đã tạm khóa Ví trả sau",
        data,
      );
    } catch (e) {
      next(e);
    }
  },

  async unfreeze(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const data = await postpaidService.unfreezeWallet(userId);
      return successResponse(
        res,
        200,
        "Đã mở khóa Ví trả sau",
        data,
      );
    } catch (e) {
      next(e);
    }
  },

  async close(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { reason } = req.body || {};
      const data = await postpaidService.closeWallet(userId, { reason });
      return successResponse(
        res,
        200,
        "Đã hủy Ví trả sau thành công",
        data,
      );
    } catch (e) {
      next(e);
    }
  },

  async getEntries(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const {
        cursor_id: cursorId,
        limit,
        keyword,
        action,
        entry_action: entryAction,
        start_date: startDate,
        end_date: endDate,
      } = req.query;
      const data = await postpaidService.getEntries(userId, {
        cursorId,
        limit,
        keyword,
        action: action || entryAction,
        startDate,
        endDate,
      });
      return successResponse(
        res,
        200,
        "Lấy lịch sử biến động Ví trả sau thành công",
        data,
      );
    } catch (e) {
      next(e);
    }
  },

  async repay(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const idempotencyKey = req.idempotencyKey;
      const {
        amount,
        funding_source: fundingSource = "MAIN_WALLET",
        linked_bank_account_id: linkedBankAccountId = null,
      } = req.body;

      const result = await postpaidService.repayDebt({
        userId,
        amount,
        idempotencyKey,
        fundingSource,
        linkedBankAccountId,
      });

      emitToUser(userId, "wallet_balance_updated", {
        balance: result.mainBalanceAfter,
        transactionId: result.transactionId,
        type: "POSTPAID_REPAY",
      });

      const viaBankSuffix = result.bankName ? ` qua ${result.bankName}` : "";
      sendPushNotification(userId, {
        title: "Thanh toán Ví trả sau thành công",
        body: `Bạn đã thanh toán ${Number(result.amount).toLocaleString("vi-VN")}đ dư nợ Ví trả sau${viaBankSuffix}. Hạn mức khả dụng: ${Number(result.availableLimitAfter).toLocaleString("vi-VN")}đ`,
        data: {
          type: "POSTPAID_REPAY",
          transactionId: result.transactionId,
          balance: result.mainBalanceAfter,
          fundingSource: result.fundingSource,
          ...(result.bankName ? { bankName: result.bankName } : {}),
        },
      });

      return successResponse(
        res,
        200,
        "Thanh toán dư nợ Ví trả sau thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async submitUnlockRequest(req, res, next) {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    try {
      const { user_id: userId } = req.user;
      const { user_note: userNote = "" } = req.body || {};
      const data = await postpaidService.createUnlockRequest({
        userId,
        userNote,
        proofFiles: uploadedFiles,
      });
      return successResponse(
        res,
        201,
        "Đã gửi yêu cầu mở khóa Ví trả sau kèm ảnh chứng minh thu nhập",
        data,
      );
    } catch (e) {
      await removeUploadedProofFiles(uploadedFiles);
      next(e);
    }
  },

  async getLatestUnlockRequest(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const data = await postpaidService.getLatestUnlockRequest(userId);
      return successResponse(
        res,
        200,
        "Lấy trạng thái yêu cầu mở khóa Ví trả sau thành công",
        data,
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = postpaidController;

