const { successResponse } = require("../../utils/apiResponse");
const { checkPinStatus } = require("./user.repository");
const userService = require("./user.service");

const userController = {
  async findUserByPhone(req, res, next) {
    try {
      const { phone } = req.query;
      const result = await userService.findUserByPhone(phone);
      return successResponse(res, 200, "Tìm người dùng thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async findUserByPhoneList(req, res, next) {
    try {
      const { phones } = req.body;
      const result = await userService.findUserByPhoneList(phones);
      return successResponse(
        res,
        200,
        "Tìm danh sách người dùng thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async checkPinStatus(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await userService.checkPinStatus(userId);
      return successResponse(
        res,
        200,
        "Kiểm tra trạng thái pin thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },
  async createPin(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { pin } = req.body;
      await userService.createPin({userId, pin});
      return successResponse(res, 201, "Tạo mã pin thành công");
    } catch (e) {
      next(e);
    }
  },
};

module.exports = userController;
