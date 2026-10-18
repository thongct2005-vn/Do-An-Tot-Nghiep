const paymentMerchantRequestService = require("./paymentRequest.service");
const { successResponse } = require("../../../utils/apiResponse");
const paymentMerchantRequestController = {
  async createDynamicQRToken(req, res, next) {
    try {
      const { id: userId } = req.merchant;
      const { amount, description, order_id: orderId } = req.body;
      const result = await paymentMerchantRequestService.createDynamicQRToken({
        userId,
        amount,
        description,
        orderId,
      });
      return successResponse(res, 200, "Tạo mã Dynamic QR thành công", result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = paymentMerchantRequestController;
