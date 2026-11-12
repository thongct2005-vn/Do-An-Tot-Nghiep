const { successResponse } = require("../../../../utils/apiResponse");
const merchantAuthService = require("./auth.service");
const tokenUtil = require("../../../../utils/jwt");
const { recordFailure, clearFailure } = require("../../../../utils/risk");

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


  async login(req, res, next) {
    try {
      const { phone, password } = req.body;
      const riskChallenge = Boolean(req.risk?.challenge);
      const result = await merchantAuthService.login({
        phone,
        password,
        riskChallenge,
      });
      clearFailure(phone);
      return successResponse(
        res,
        200,
        "Vui lòng nhập mã OTP để hoàn tất đăng nhập",
        result,
      );
    } catch (e) {
      if (e.statusCode && e.statusCode < 500) {
        recordFailure(req.body?.phone);
      }
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
      const { otp, tax_code_last4: taxCodeLast4, cccd_last4: cccdLast4 } =
        req.body;
      const {
        user_id: userId,
        phone,
        require_tax_code_last4: requireTaxCodeLast4,
      } = req.otpUser;
      const result = await merchantAuthService.verifyLoginOtp({
        userId,
        phone,
        otp,
        taxCodeLast4: taxCodeLast4 ?? cccdLast4,
        requireTaxCodeLast4: Boolean(requireTaxCodeLast4 || req.risk?.challenge),
      });
      clearFailure(phone);
      setRefreshCookie(res, result.token.refresh_token);
      return successResponse(res, 200, "Đăng nhập thành công", {
        ...result,
        token: publicToken(result.token),
      });
    } catch (e) {
      if (e.statusCode && e.statusCode < 500) {
        recordFailure(req.otpUser?.phone);
      }
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
      clearFailure(phone);
      return successResponse(res, 200, "Đăng ký tài khoản thành công", {
        ...result,
        token: publicToken(result.token),
      });
    } catch (e) {
      if (e.statusCode && e.statusCode < 500) {
        recordFailure(req.otpUser?.phone);
      }
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
      clearFailure(phone);
      return successResponse(res, 200, "Tạo mã QR thành công", result);
    } catch (e) {
      if (e.statusCode && e.statusCode < 500) {
        recordFailure(req.user?.phone);
      }
      next(e);
    }
  },

  async enableTotp(req, res, next) {
    try {
      const { user_id: userId, phone } = req.user;
      const { code } = req.body;
      await merchantAuthService.enableTotp({ userId, code });
      clearFailure(phone);
      return successResponse(res, 200, "Đã bật Google Authenticator");
    } catch (e) {
      if (e.statusCode && e.statusCode < 500) {
        recordFailure(req.user?.phone);
      }
      next(e);
    }
  },

  async disableTotp(req, res, next) {
    try {
      const { user_id: userId, phone } = req.user;
      const { code } = req.body;
      await merchantAuthService.disableTotp({ userId, code });
      clearFailure(phone);
      return successResponse(res, 200, "Đã tắt Google Authenticator");
    } catch (e) {
      if (e.statusCode && e.statusCode < 500) {
        recordFailure(req.user?.phone);
      }
      next(e);
    }
  },

  // ===== Quên mật khẩu Merchant =====
  async forgotRequest(req, res, next) {
    try {
      const { phone } = req.body;
      const result = await merchantAuthService.forgotPasswordRequest({ phone });
      clearFailure(phone);
      const message =
        result.otp_method === "totp"
          ? "Vui lòng nhập mã Google Authenticator và mã số thuế để xác nhận"
          : "Vui lòng nhập mã OTP email và mã số thuế để xác nhận";
      return successResponse(res, 200, message, result);
    } catch (e) {
      if (e.statusCode && e.statusCode < 500) {
        recordFailure(req.body?.phone);
      }
      next(e);
    }
  },

  async forgotResendOtp(req, res, next) {
    try {
      const { user_id: userId, phone } = req.otpUser;
      const result = await merchantAuthService.forgotPasswordResendOtp({
        userId,
        phone,
      });
      return successResponse(res, 200, "Đã gửi lại mã OTP", result);
    } catch (e) {
      next(e);
    }
  },

  async forgotVerify(req, res, next) {
    try {
      const { otp, tax_code: taxCode } = req.body;
      const { user_id: userId, phone } = req.otpUser;
      const result = await merchantAuthService.forgotPasswordVerify({
        userId,
        phone,
        otp,
        taxCode,
      });
      clearFailure(phone);
      return successResponse(res, 200, "Xác thực thành công", result);
    } catch (e) {
      if (e.statusCode && e.statusCode < 500) {
        recordFailure(req.otpUser?.phone);
      }
      next(e);
    }
  },

  async forgotResetPassword(req, res, next) {
    try {
      const { password, confirm_password: confirmPassword } = req.body;
      const {
        user_id: userId,
        pv: version,
        tax_code_hash: taxCodeHash,
      } = req.resetUser;
      await merchantAuthService.forgotPasswordReset({
        userId,
        version,
        taxCodeHash,
        password,
        confirmPassword,
      });
      return successResponse(res, 200, "Đặt lại mật khẩu thành công");
    } catch (e) {
      next(e);
    }
  },

  // ===== Đổi mật khẩu Merchant khi đã đăng nhập =====
  async changePasswordRequest(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await merchantAuthService.changePasswordRequest({
        userId,
      });
      const message =
        result.otp_method === "totp"
          ? "Vui lòng nhập mã Google Authenticator để xác nhận"
          : "Vui lòng nhập mã OTP gửi về email để xác nhận";
      return successResponse(res, 200, message, result);
    } catch (e) {
      next(e);
    }
  },

  async changePasswordResendOtp(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await merchantAuthService.changePasswordResendOtp({
        userId,
      });
      return successResponse(res, 200, "Đã gửi lại mã OTP", result);
    } catch (e) {
      next(e);
    }
  },

  async changePasswordVerify(req, res, next) {
    try {
      const { user_id: userId, phone } = req.user;
      const { otp } = req.body;
      const result = await merchantAuthService.changePasswordVerify({
        userId,
        otp,
      });
      clearFailure(phone);
      return successResponse(res, 200, "Xác thực thành công", result);
    } catch (e) {
      if (e.statusCode && e.statusCode < 500) {
        recordFailure(req.user?.phone);
      }
      next(e);
    }
  },

  async changePasswordReset(req, res, next) {
    try {
      const {
        old_password: oldPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      } = req.body;
      const { user_id: userId } = req.user;
      const { pv: version } = req.otpUser;
      await merchantAuthService.changePasswordReset({
        userId,
        version,
        oldPassword,
        newPassword,
        confirmPassword,
      });
      clearRefreshCookie(res);
      return successResponse(res, 200, "Đổi mật khẩu thành công");
    } catch (e) {
      next(e);
    }
  },
};

module.exports = merchantAuthController;
