const { successResponse } = require('../../utils/apiResponse');
const { getWalletBalanceByUserId } = require('./wallet.repository');
const walletService = require('./wallet.service');

const walletController = {
  async getWalletBalanceByUserId(req, res, next) {
    try {
      const { user_id } = req.user;
      const data = await walletService.getWalletBalanceByUserId(user_id);
      return successResponse(res, 200, 'Lấy số dư ví thành công', data);
    } catch (e) {
      next(e);
    }
  },
  async checkTransferEligibility (req, res, next){
    try{
      const {user_id} = req.user;
      const {amount} = req.body;
      const data = await walletService.checkTransferEligibility({user_id,amount});
      console.log(data);
      return successResponse(res, 200, 'Kiểm tra số dư thành công', data);
    }
    catch(e){
      next(e);
    }
  }
};
module.exports = walletController;
