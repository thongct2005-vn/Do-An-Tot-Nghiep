const { successResponse } = require("../../utils/apiResponse");
const kycService = require("./kyc.service");
const kycController = {
  async checkUserKYC(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await kycService.checkUserKYC(userId);
      return successResponse(
        res,
        200,
        "Kiểm tra thông tin định danh thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },
  async verifyAndSaveKYC(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const frontPath = req.files.front_id?.[0].path;
      const backPath = req.files.back_id?.[0].path;
      const facePath = req.files.face?.[0].path;
      const result = await kycService.verifyAndSaveKYC({
        userId,
        frontPath,
        backPath,
        facePath,
      });
      return successResponse(res, 200, "Xác thực danh tính thành công", result);
    } catch (e) {
      next(e);
    }
  },
};
module.exports = kycController;
