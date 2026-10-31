const { successResponse } = require("../../../../utils/apiResponse");
const merchantWalletService = require("./wallet.service");

const mercahntWalletController = {
  async getWalletByUserId(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await merchantWalletService.getWalletByUserId(userId);
      return successResponse(res, 200, "Lấy số dư ví thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async checkTransferEligibility(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { amount } = req.body;
      const result = await merchantWalletService.checkTransferEligibility({
        userId,
        amount,
      });
      return successResponse(res, 200, "Kiểm tra số dư thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async checkPin(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { pin } = req.body;
      const result = await merchantWalletService.checkPin({userId, pin});
      return successResponse(res, 200, "Kiểm tra mã PIN thành công", result);
    } catch (e) {
      next(e);
    }
  },
};
module.exports = mercahntWalletController;
