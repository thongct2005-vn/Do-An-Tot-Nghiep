const { successResponse } = require("../../utils/apiResponse");
const { getWalletBalanceByUserId } = require("./wallet.repository");
const walletService = require("./wallet.service");

const walletController = {
  async getWalletBalanceByUserId(req, res, next) {
    try {
      const { user_id } = req.user;
      const data = await walletService.getWalletBalanceByUserId(user_id);
      return successResponse(res, 200, "Lấy số dư ví thành công", data);
    } catch (e) {
      next(e);
    }
  },
};
module.exports = walletController;
