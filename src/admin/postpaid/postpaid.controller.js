const { successResponse } = require("../../utils/apiResponse");
const { sendPostpaidProofImageFile } = require("../../utils/postpaidProofImage");
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
      return successResponse(res, 200, "Từ chối yêu cầu mở khóa Ví trả sau thành công", data);
    } catch (e) {
      return next(e);
    }
  },
};

module.exports = adminPostpaidController;
