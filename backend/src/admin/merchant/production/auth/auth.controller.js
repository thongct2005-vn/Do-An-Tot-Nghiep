const { successResponse } = require("../../../../utils/apiResponse");
const merchantAuthService = require("./auth.service");
const tokenUtil = require("../../../../utils/jwt");

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/v2/merchant/auth",
};

function setRefreshCookie(res, refreshToken) {
  res.cookie(tokenUtil.MERCHANT_REFRESH_COOKIE, refreshToken, {
    ...REFRESH_COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(tokenUtil.MERCHANT_REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS);
}

function publicToken(token) {
  return { access_token: token.access_token };
}

const merchantAuthController = {
  async isPhoneExist(req, res, next) {
    try {
      const { phone } = req.body;
      const result = await merchantAuthService.isPhoneExist(phone);
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
      const result = await merchantAuthService.isEmailExist(email);
      return successResponse(res, 200, "Kiểm tra email thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async login(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await merchantAuthService.login({ phone, password });
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
      const result = await merchantAuthService.resendLoginOtp({
        userId,
        phone,
      });
      return successResponse(res, 200, "Đã gửi lại mã OTP", result);
    } catch (e) {
      next(e);
    }
  },

  async verifyLoginOtp(req, res, next) {
    try {
      const { otp } = req.body;
      const { user_id: userId, phone } = req.otpUser;
      const result = await merchantAuthService.verifyLoginOtp({
        userId,
        phone,
        otp,
      });
      setRefreshCookie(res, result.token.refresh_token);
      return successResponse(res, 200, "Đăng nhập thành công", {
        ...result,
        token: publicToken(result.token),
      });
    } catch (e) {
      next(e);
    }
  },

  async logout(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      await merchantAuthService.logout(userId);
      clearRefreshCookie(res);
      return successResponse(res, 200, "Đăng xuất thành công");
    } catch (e) {
      next(e);
    }
  },

  async refreshToken(req, res, next) {
    try {
      const result = await merchantAuthService.refreshToken(req.refreshToken);
      setRefreshCookie(res, result.token.refresh_token);
      return successResponse(res, 200, "Làm mới token thành công", {
        token: publicToken(result.token),
      });
    } catch (e) {
      if (e.statusCode === 401) clearRefreshCookie(res);
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
      const result = await merchantAuthService.register({ phone, email });
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
      const {
        otp,
        password,
        tax_code: taxCode,
        call_back_url: callbackUrl,
        store_name: storeName,
      } = req.body;
      const { user_id: userId, phone, email } = req.otpUser;
      const result = await merchantAuthService.verifyAndCompleteRegister({
        userId,
        phone,
        email,
        otp,
        password,
        taxCode,
        callbackUrl,
        storeName,
      });
      return successResponse(res, 200, "Đăng ký tài khoản thành công", {
        ...result,
        token: publicToken(result.token),
      });
    } catch (e) {
      next(e);
    }
  },

  // ===== Google Authenticator =====
  async getTotpStatus(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await merchantAuthService.getTotpStatus(userId);
      return successResponse(
        res,
        200,
        "Lấy trạng thái bảo mật thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async setupTotp(req, res, next) {
    try {
      const { user_id: userId, phone } = req.user;
      const { password } = req.body;
      const result = await merchantAuthService.setupTotp({
        userId,
        phone,
        password,
      });
      return successResponse(res, 200, "Tạo mã QR thành công", result);
    } catch (e) {
      next(e);
    }
  },

  async enableTotp(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { code } = req.body;
      await merchantAuthService.enableTotp({ userId, code });
      return successResponse(res, 200, "Đã bật Google Authenticator");
    } catch (e) {
      next(e);
    }
  },

  async disableTotp(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { code } = req.body;
      await merchantAuthService.disableTotp({ userId, code });
      return successResponse(res, 200, "Đã tắt Google Authenticator");
    } catch (e) {
      next(e);
    }
  },
};

module.exports = merchantAuthController;
