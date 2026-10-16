const tokenUtil = require("../utils/jwt");
const { httpError } = require("../utils/httpError");
const authMiddleware = {
  verifyAccessToken(req, res, next) {
    try {
      const authHeader = req.headers["authorization"];
      const accessToken = authHeader && authHeader.split(" ")[1];
      if (!accessToken) {
        const err = new Error(
          "Thiếu thông tin xác thực, vui lòng đăng nhập lại",
        );
        err.statusCode = 401;
        throw err;
      }

      const decoded = tokenUtil.verifyAccessToken(accessToken);
      req.user = decoded;
      next();
    } catch (e) {
      handleTokenError(e, next);
    }
  },

  verifyRefreshToken(req, res, next) {
    try {
      const { refresh_token } = req.body;
      if (!refresh_token) {
        const err = new Error("Thiếu thông tin xác thực");
        err.statusCode = 401;
        throw err;
      }

      const decoded = tokenUtil.verifyRefreshToken(refresh_token);
      req.user = decoded;
      next();
    } catch (e) {
      handleTokenError(e, next);
    }
  },

  verifyLoginOtpToken(req, res, next) {
    try {
      const { otp_token: otpToken } = req.body;
      if (!otpToken) {
        const err = new Error("Thiếu thông tin xác thực");
        err.statusCode = 401;
        throw err;
      }
      req.otpUser = tokenUtil.verifyOtpToken(otpToken, "login_otp");
      next();
    } catch (e) {
      handleTokenError(e, next);
    }
  },

  verifyRegisterOtpToken(req, res, next) {
    try {
      const { otp_token: otpToken } = req.body;
      if (!otpToken) {
        const err = new Error("Thiếu thông tin xác thực");
        err.statusCode = 401;
        throw err;
      }
      req.otpUser = tokenUtil.verifyOtpToken(otpToken, "register_otp");
      next();
    } catch (e) {
      handleTokenError(e, next);
    }
  },

  requireRole(role) {
    return (req, res, next) => {
      if (!req.user || req.user.type !== role) {
        return next(
          httpError(403, "Bạn không có quyền truy cập chức năng này"),
        );
      }
      next();
    };
  },
};

function handleTokenError(e, next) {
  if (e.statusCode) return next(e);
  if (e.name === "TokenExpiredError") {
    const err = new Error("Token đã hết hạn");
    err.statusCode = 401;
    return next(err);
  }
  if (e.name === "JsonWebTokenError") {
    const err = new Error("Token không hợp lệ");
    err.statusCode = 401;
    return next(err);
  }
  const err = new Error(e.message || "Lỗi xác thực");
  err.statusCode = 500;
  next(err);
}

module.exports = authMiddleware;
