const { successResponse } = require("../../../../utils/apiResponse");
const merchantAuthService = require("./auth.service");
const tokenUtil = require("../../../../utils/jwt");

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/v2/merchant/sandbox/auth",
};

function setRefreshCookie(res, refreshToken) {
  res.cookie(tokenUtil.MERCHANT_SANDBOX_REFRESH_COOKIE, refreshToken, {
    ...REFRESH_COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(
    tokenUtil.MERCHANT_SANDBOX_REFRESH_COOKIE,
    REFRESH_COOKIE_OPTIONS,
  );
}

function publicToken(token) {
  return { access_token: token.access_token };
}

const merchantAuthController = {
  async login(req, res, next) {
    try {
      const { phone, password } = req.body;
      const result = await merchantAuthService.login({ phone, password });
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


  async register(req, res, next) {
    try {
      const {
        phone,
        email,
        password,
        call_back_url: callbackUrl,
        store_name: storeName,
      } = req.body;
      const result = await merchantAuthService.register({
        phone,
        email,
        password,
        callbackUrl,
        storeName,
      });
      return successResponse(res, 200, "Đăng ký tài khoản thành công", {
        user_info: result.user_info,
      });
    } catch (e) {
      next(e);
    }
  },
};

module.exports = merchantAuthController;