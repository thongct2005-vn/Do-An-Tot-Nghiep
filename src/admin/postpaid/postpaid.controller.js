const { successResponse } = require("../../utils/apiResponse");
const { sendPostpaidProofImageFile } = require("../../utils/postpaidProofImage");
const { emitToUser } = require("../../utils/socket");
const adminPostpaidService = require("./postpaid.service");

const adminPostpaidController = {
  async getOverview(req, res, next) {
    try {
      const data = await adminPostpaidService.getOverview();
      return successResponse(res, 200, "Lấy tổng quan Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },

  async listWallets(req, res, next) {
    try {
      const data = await adminPostpaidService.listWallets(req.query);
      return successResponse(res, 200, "Lấy danh sách Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },

  async getWalletDetail(req, res, next) {
    try {
      const data = await adminPostpaidService.getWalletDetail(req.params.userId);
      return successResponse(res, 200, "Lấy chi tiết Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },

  async listEntries(req, res, next) {
    try {
      const data = await adminPostpaidService.listEntries(req.query);
      return successResponse(res, 200, "Lấy sổ cái Ví trả sau toàn hệ thống thành công", data);
    } catch (e) {
      return next(e);
    }
  },

  async freezeWallet(req, res, next) {
    try {
      const body = Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body || {};
      const data = await adminPostpaidService.freezeWallet({
        userId: req.params.userId,
        adminId: req.user?.user_id,
        reason: body?.reason,
      });
      emitToUser(req.params.userId, "postpaid_wallet_updated", {
        status: data?.status || "FROZEN",
        lockReason: data?.lock_reason || "ADMIN_FREEZE",
        type: "POSTPAID_ADMIN_FROZEN",
      });
      return successResponse(res, 200, "Khóa Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },

  async unfreezeWallet(req, res, next) {
    try {
      const body = Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body || {};
      const data = await adminPostpaidService.unfreezeWallet({
        userId: req.params.userId,
        adminId: req.user?.user_id,
        reason: body?.reason,
      });
      emitToUser(req.params.userId, "postpaid_wallet_updated", {
        status: data?.status || "ACTIVE",
        lockReason: data?.lock_reason ?? null,
        type: "POSTPAID_ADMIN_UNFROZEN",
      });
      return successResponse(res, 200, "Mở khóa Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },

  async adjustCreditLimit(req, res, next) {
    try {
      const body = Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body || {};
      const data = await adminPostpaidService.adjustCreditLimit({
        userId: req.params.userId,
        adminId: req.user?.user_id,
        credit_limit: body?.credit_limit,
        reason: body?.reason,
      });
      emitToUser(req.params.userId, "postpaid_wallet_updated", {
        creditLimit: data?.credit_limit,
        availableLimit: data?.available_limit,
        type: "POSTPAID_LIMIT_ADJUSTED",
      });
      return successResponse(res, 200, "Điều chỉnh hạn mức Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },

  async listUnlockRequests(req, res, next) {
    try {
      const data = await adminPostpaidService.listUnlockRequests(req.query);
      return successResponse(res, 200, "Lấy danh sách yêu cầu mở khóa Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },

  async getUnlockProofImage(req, res, next) {
    try {
      const filePath = await adminPostpaidService.getUnlockProofFilePath({
        requestId: req.params.id,
        index: req.params.index,
      });
      return sendPostpaidProofImageFile({ res, next, filePath });
    } catch (e) {
      return next(e);
    }
  },

  async approveUnlockRequest(req, res, next) {
    try {
      const body = Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body || {};
      const data = await adminPostpaidService.approveUnlockRequest({
        requestId: req.params.id,
        adminId: req.user?.user_id,
        reason: body?.reason,
      });
      if (data?.user_id) {
        emitToUser(data.user_id, "postpaid_wallet_updated", {
          status: data.wallet_status,
          lockReason: data.lock_reason,
          creditLimit: data.credit_limit,
          requestId: data.request_id,
          requestStatus: data.status,
          type: "POSTPAID_UNLOCK_APPROVED",
        });
      }
      return successResponse(res, 200, "Duyệt yêu cầu mở khóa Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },

  async rejectUnlockRequest(req, res, next) {
    try {
      const body = Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body || {};
      const data = await adminPostpaidService.rejectUnlockRequest({
        requestId: req.params.id,
        adminId: req.user?.user_id,
        reason: body?.reason,
      });
      if (data?.user_id) {
        emitToUser(data.user_id, "postpaid_wallet_updated", {
          status: data.wallet_status,
          lockReason: data.lock_reason,
          requestId: data.request_id,
          requestStatus: data.status,
          adminNote: data.admin_note,
          type: "POSTPAID_UNLOCK_REJECTED",
        });
      }
      return successResponse(res, 200, "Từ chối yêu cầu mở khóa Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },
};

module.exports = adminPostpaidController;
