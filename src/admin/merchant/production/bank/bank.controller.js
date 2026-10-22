const merchantBankService = require("./bank.service");
const { successResponse} = require("../../../../utils/apiResponse");

const merchantBankController = {
  async getBankLinkStatus(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await merchantBankService.getBankLinkStatus(userId);
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
      await merchantBankService.linkBankAccount({ userId, bankId });
      return successResponse(res, 200, "Liên kết ngân hàng thành công");
    } catch (e) {
      next(e);
    }
  },
};

module.exports = merchantBankController;
