const { successResponse } = require("../../utils/apiResponse");
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
};

module.exports = userController;
