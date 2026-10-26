const { successResponse } = require("../../utils/apiResponse");
const userService = require("./user.service");

const userController = {
  async findUserByPhone(req, res, next) {
    try {
      const { phone } = req.query;
      const { user_id: userId } = req.user;
      const result = await userService.findUserByPhone({ userId, phone });
      return successResponse(res, 200, "Tìm người dùng thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async findUserByPhoneHashList(req, res, next) {
    try {
      const { phones } = req.body;
      const { user_id: userId } = req.user;
      const result = await userService.findUserByPhoneHashList(phones);
      const foundUsers = result.filter((u) => u.id !== userId);
      return successResponse(
        res,
        200,
        "Tìm danh sách người dùng thành công",
        foundUsers,
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
      await userService.createPin({ userId, pin });
      return successResponse(res, 201, "Tạo mã pin thành công");
    } catch (e) {
      next(e);
    }
  },
  async updateFcmToken(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { fcm_token: fcmToken } = req.body;
      await userService.updateFmcToken({ userId, fcmToken });
      return successResponse(res, 200, "Cập nhật fcm token thành công");
    } catch (e) {
      next(e);
    }
  },
  async getFcmToken(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await userService.getFcmToken(userId);
      return successResponse(res, 200, "Lấy fcm token thành công", {
        fcm_token: result,
      });
    } catch (e) {
      next(e);
    }
  },
  async resetPin(req, res, next) {
    try {
      const { user_id: userId, pv: version } = req.resetUser;
      const { pin } = req.body;
      await userService.resetPin({ userId, version, pin });
      return successResponse(res, 200, "Đặt lại mã PIN thành công");
    } catch (e) {
      next(e);
    }
  },
  async resetPassword(req, res, next) {
    try {
      const { user_id: userId, pv: version } = req.resetUser;
      const { password } = req.body;
      await userService.resetPassword({ userId, version, password });
      return successResponse(res, 200, "Đặt lại mật khẩu thành công");
    } catch (e) {
      next(e);
    }
  },

 
  async forgotRequest(req, res, next) {
    try {
      const { phone, type } = req.body;
      const result = await userService.forgotRequest({ phone, type });
      return successResponse(res, 200, "Đã gửi mã OTP về email của bạn", result);
    } catch (e) {
      next(e);
    }
  },
  async forgotResendOtp(req, res, next) {
    try {
      const { user_id: userId, phone } = req.otpUser;
      const result = await userService.forgotResendOtp({ userId, phone });
      return successResponse(res, 200, "Đã gửi lại mã OTP", result);
    } catch (e) {
      next(e);
    }
  },
  async forgotVerifyOtp(req, res, next) {
    try {
      const { otp } = req.body;
      const { user_id: userId, phone, type } = req.otpUser;
      const result = await userService.forgotVerifyOtp({
        userId,
        phone,
        type,
        otp,
      });
      return successResponse(res, 200, "Xác thực OTP thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async forgotVerifyKyc(req, res, next) {
    try {
      const { user_id: userId, type } = req.forgotUser;
      const result = await userService.forgotVerifyKyc({
        userId,
        type,
        frontPath: req.files?.front_id?.[0]?.path,
        backPath: req.files?.back_id?.[0]?.path,
        facePath: req.files?.face?.[0]?.path,
      });
      return successResponse(res, 200, "Xác thực danh tính thành công", result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = userController;