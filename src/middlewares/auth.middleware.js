const crypto = require("crypto");
const tokenUtil = require("../utils/jwt");
const { httpError } = require("../utils/httpError");
const { computeSignature, isSameSignature } = require("../utils/hashSecretKey");
const dashboardRepository = require("../admin/merchant/dashboard/dashboard.repository");
const MERCHANT_TIMESTAMP_TOLERANCE = 5 * 60;

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

  async verifyMerchant(req, res, next) {
    try {
      const apiKey = req.headers["x-api-key"];
      const timestamp = req.headers["x-timestamp"];
      const signature = req.headers["x-signature"];

      if (!apiKey || !timestamp || !signature) {
        throw httpError(401, "Thiếu thông tin xác thực merchant");
      }

      const ts = Number(timestamp);
      const now = Math.floor(Date.now() / 1000);
      if (
        !Number.isInteger(ts) ||
        Math.abs(now - ts) > MERCHANT_TIMESTAMP_TOLERANCE
      ) {
        throw httpError(401, "Request đã hết hạn hoặc thời gian không hợp lệ");
      }

      const merchant =
        await dashboardRepository.getMerchantInfoByApiKey(apiKey);
      if (!merchant) {
        throw httpError(401, "API Key không hợp lệ");
      }

      const expected = computeSignature(
        merchant.secret_key,
        timestamp,
        req.rawBody,
      );
      if (!isSameSignature(signature, expected)) {
        throw httpError(401, "Chữ ký không hợp lệ");
      }

      const { secret_key: _secretKey, ...safeMerchant } = merchant;
      req.merchant = safeMerchant;
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
