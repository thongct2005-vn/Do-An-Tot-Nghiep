const paymentRequestService = require("./paymentRequest.service");
const { successResponse } = require("../../utils/apiResponse");
const paymentRequestController = {
  async createStaticQRToken(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const token = await paymentRequestService.createStaticQRToken(userId);
      return successResponse(res, 200, "Tạo Static QR thành công", token);
    } catch (e) {
      next(e);
    }
  },

  async getUserAndWalletByStaticQRToken(req, res, next) {
    try {
      const { user_id: requestingUserId } = req.user;
      const { static_qr_token: token } = req.query;
      const result =
        await paymentRequestService.getUserAndWalletByStaticQRToken({
          token,
          requestingUserId,
        });
      return successResponse(
        res,
        200,
        "Lấy thông tin người nhận thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async createDynamicQRToken(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { amount, description } = req.body;
      const result = await paymentRequestService.createDynamicQRToken({
        userId,
        amount,
        description,
      });
      return successResponse(res, 200, "Tạo mã Dynamic QR thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async getUserAndWalletByDynamicQRToken(req, res, next) {
    try {
      const { user_id: requestingUserId } = req.user;
      const { reference_code: referenceCode } = req.query;
      const result =
        await paymentRequestService.getUserAndWalletByDynamicQRToken({
          referenceCode,
          requestingUserId,
        });
      return successResponse(
        res,
        200,
        "Lấy thông tin người nhận thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = paymentRequestController;
