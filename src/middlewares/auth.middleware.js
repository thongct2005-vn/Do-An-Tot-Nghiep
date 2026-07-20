const jwt = require("jsonwebtoken");
require("dotenv").config();
const ACCESS_SECRET = process.env.ACCESS_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;

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

      const decoded = jwt.verify(accessToken, ACCESS_SECRET);
      req.user = decoded;
      next();
    } catch (e) {
      if (e.name === "TokenExpiredError") {
        const err = new Error("Phiên đăng nhập đã hết hạn");
        err.statusCode = 401;
        throw err;
      }

      if (e.name === "JsonWebTokenError") {
        const err = new Error("Phiên đăng nhập không hợp lệ");
        err.statusCode = 401;
        throw err;
      }

      const err = new Error(e);
      err.statusCode = 500;
      throw err;
    }
  },

  verifyRefreshToken(req, res, next) {
    try {
      const { refresh_token } = req.body;
      if (!refresh_token) {
        const err = new Error("Thiếu thông tin xác thực");
        err.statusCode = 400;
        throw err;
      }

      const decoded = jwt.verify(refresh_token, REFRESH_SECRET);
      req.user = decoded;
      next();
    } catch (e) {
      if (e.name === "TokenExpiredError") {
        const err = new Error("Phiên đăng nhập đã hết hạn");
        err.statusCode = 401;
        throw err;
      }

      if (e.name === "JsonWebTokenError") {
        const err = new Error("Phiên đăng nhập không hợp lệ");
        err.statusCode = 401;
        throw err;
      }

      const err = new Error(e);
      err.statusCode = 500;
      throw err;
    }
  },
};

module.exports = authMiddleware;
