const jwt = require("jsonwebtoken");
const tokenUtil = require('../utils/jwt')

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
      if (e.statusCode) {
        return next(e);
      }

      if (e.name === "TokenExpiredError") {
        const err = new Error("Phiên đăng nhập đã hết hạn");
        err.statusCode = 401;
        return next(err);
      }

      if (e.name === "JsonWebTokenError") {
        const err = new Error("Phiên đăng nhập không hợp lệ");
        err.statusCode = 401;
        return next(err);
      }

      const err = new Error(e.message || "Lỗi xác thực");
      err.statusCode = 500;
      next(err);
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
      if (e.statusCode) {
        return next(e);
      }

      if (e.name === "TokenExpiredError") {
        const err = new Error("Phiên đăng nhập đã hết hạn");
        err.statusCode = 401;
        return next(err);
      }

      if (e.name === "JsonWebTokenError") {
        const err = new Error("Phiên đăng nhập không hợp lệ");
        err.statusCode = 401;
        return next(err);
      }

      const err = new Error(e.message || "Lỗi xác thực");
      err.statusCode = 500;
      next(err);
    }
  },
};

module.exports = authMiddleware;