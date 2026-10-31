const { successResponse } = require("../../utils/apiResponse");
const authService = require("./auth.service");

const authController = {
  async isPhoneExist(req, res, next) {
    try {
      const { phone } = req.body;
      const result = await authService.isPhoneExist(phone);
      return successResponse(
        res,
        200,
        "Kiểm tra số điện thoại thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async isEmailExist(req, res, next) {
    try {
      const { email } = req.body;
      const result = await authService.isEmailExist(email);
      return successResponse(res, 200, "Kiểm tra email thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async login(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await authService.login({ phone, password });
      return successResponse(
        res,
        200,
        "Vui lòng nhập mã OTP để hoàn tất đăng nhập",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async resendLoginOtp(req, res, next) {
    try {
      const { user_id: userId, phone } = req.otpUser;
      const result = await authService.resendLoginOtp({ userId, phone });
      return successResponse(res, 200, "Đã gửi lại mã OTP", result);
    } catch (e) {
      next(e);
    }
  },

  async verifyLoginOtp(req, res, next) {
    try {
      const { otp } = req.body;
      const { user_id: userId, phone } = req.otpUser;
      const result = await authService.verifyLoginOtp({ userId, phone, otp });
      return successResponse(res, 200, "Đăng nhập thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async logout(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      await authService.logout(userId);
      return successResponse(res, 200, "Đăng xuất thành công");
    } catch (e) {
      next(e);
    }
  },

  async refreshToken(req, res, next) {
    try {
      const { refresh_token: refreshToken } = req.body;
      const result = await authService.refreshToken(refreshToken);
      return successResponse(res, 200, "Làm mới token thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async getMe(req, res, next) {
    try {
      const { user_id: userId, phone, full_name: fullName } = req.user;
      const result = {
        user_info: {
          user_id: userId,
          phone: phone,
          full_name: fullName,
        },
      };
      return successResponse(
        res,
        200,
        "Lấy thông tin người dùng thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async register(req, res, next) {
    try {
      const { phone, email } = req.body;
      const result = await authService.register({ phone, email });
      return successResponse(
        res,
        200,
        "Vui lòng nhập mã OTP để hoàn tất đăng ký",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async verifyRegister(req, res, next) {
    try {
      const { otp, password } = req.body;
      const { user_id: userId, phone, email } = req.otpUser;
      const result = await authService.verifyAndCompleteRegister({
        userId,
        phone,
        email,
        otp,
        password,
      });
      return successResponse(res, 200, "Đăng ký tài khoản thành công", result);
    } catch (e) {
      next(e);
    }
  },

  // ===== Google Authenticator =====
  async setupTotp(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await authService.setupTotp({ phone, password });
      return successResponse(res, 200, "Tạo mã QR thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async recoverTotp(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await authService.recoverTotp({ phone, password });
      return successResponse(res, 200, "Lấy lại mã QR thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async enableTotp(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { code } = req.body;
      await authService.enableTotp({ userId, code });
      return successResponse(res, 200, "Đã bật Google Authenticator");
    } catch (e) {
      next(e);
    }
  },

  async disableTotp(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      await authService.disableTotp(userId);
      return successResponse(res, 200, "Đã chuyển sang nhận OTP qua email");
    } catch (e) {
      next(e);
    }
  },
};

module.exports = authController;
