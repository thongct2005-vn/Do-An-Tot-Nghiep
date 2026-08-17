const bankService = require("./bank.service");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { linkBankAccount } = require("./bank.repository");

const bankController = {
  async getBankLinkStatus(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await bankService.getBankLinkStatus(userId);
      return successResponse(
        res,
        200,
        "Lấy danh danh ngân hàng đã liên kết thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },
  async linkBankAccount(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { bank_id: bankId } = req.body;
      await bankService.linkBankAccount({ userId, bankId });
      return successResponse(res, 200, "Liên kết ngân hàng thành công");
    } catch (e) {
      next(e);
    }
  },
};

module.exports = bankController;
