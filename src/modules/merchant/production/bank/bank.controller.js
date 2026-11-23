// bank.controller.js: Controller xử lý HTTP cho liên kết và số dư ngân hàng của Merchant.
const merchantBankService = require("./bank.service");
const { successResponse } = require("../../../../utils/common/http");
const { createSharedBankController } = require("../../../bank/bank.helpers");

const merchantBankController = {
  ...createSharedBankController(merchantBankService),

  async getLinkedAccountBalance(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { linkedBankAccountId } = req.params;
      const result = await merchantBankService.getLinkedAccountBalance({
        userId,
        linkedBankAccountId,
      });
      return successResponse(res, 200, "Lấy số dư ngân hàng thành công", result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = merchantBankController;
