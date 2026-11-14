const bankService = require("./bank.service");
const { successResponse} = require("../../utils/apiResponse");

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
  async enableShowBalance(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { linked_bank_account_id: linkedBankAccountId } = req.body;
      const result = await bankService.enableShowBalance({
        userId,
        linkedBankAccountId,
      });
      return successResponse(
        res,
        200,
        "Đã bật hiển thị số dư ngân hàng",
        result,
      );
    } catch (e) {
      next(e);
    }
  },
  async unlinkBankAccount(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { linked_bank_account_id: linkedBankAccountId } = req.body;
      await bankService.unlinkBankAccount({
        userId,
        linkedBankAccountId,
      });
      return successResponse(res, 200, "Hủy liên kết ngân hàng thành công");
    } catch (e) {
      next(e);
    }
  },
};

module.exports = bankController;
