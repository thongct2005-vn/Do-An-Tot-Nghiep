const paymentMerchantRequestService = require("./paymentRequest.service");
const { successResponse } = require("../../../../utils/apiResponse");
const { getPublicBaseUrl } = require("../../../../utils/publicUrl");
const paymentMerchantRequestController = {
  async createDynamicQRToken(req, res, next) {
    try {
      const { id: userId } = req.merchant;
      const {
        amount,
        description,
        order_id: orderId,
        items,
        callback_url: callbackUrl,
        return_url: returnUrl,
      } = req.body;
      const result = await paymentMerchantRequestService.createDynamicQRToken({
        userId,
        amount,
        description,
        orderId,
        items,
        callbackUrl,
        returnUrl,
        baseUrl: getPublicBaseUrl(req),
      });
      return successResponse(res, 200, "Tạo mã Dynamic QR thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async findPaymentByOrderId(req, res, next) {
    try {
      const { id: merchantId } = req.merchant;
      const orderId = req.params.orderId;
      const result = await paymentMerchantRequestService.findPaymentByOrderId({
        orderId,
        merchantId,
      });
      return successResponse(
        res,
        200,
        "Lấy thông tin hóa đơn thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = paymentMerchantRequestController;