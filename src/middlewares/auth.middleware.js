const tokenUtil = require("../utils/jwt");
const { httpError } = require("../utils/httpError");
const { computeSignature, isSameSignature } = require("../utils/hashSecretKey");
const dashboardRepository = require("../admin/merchant/production/dashboard/dashboard.repository");
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

  
  verifyRefreshTokenCookie: createRefreshCookieVerifier(
    tokenUtil.MERCHANT_REFRESH_COOKIE,
  ),

  verifySandboxRefreshTokenCookie: createRefreshCookieVerifier(
    tokenUtil.MERCHANT_SANDBOX_REFRESH_COOKIE,
  ),

  verifyLoginOtpToken(req, res, next) {
    try {
      const otpToken = req.headers["x-otp-token"];
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
      const otpToken = req.headers["x-otp-token"];
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

  verifyTransactionOtpToken(req, res, next) {
    try {
      const otpToken = req.headers["x-otp-token"];
      const idempotencyKey = req.headers["idempotency-key"];
      if (!otpToken || !idempotencyKey) {
        throw httpError(403, "Thiếu mã xác thực OTP của giao dịch");
      }

      const payload = tokenUtil.verifyTransactionOtpToken(otpToken);
      if (
        !req.user ||
        payload.user_id !== req.user.user_id ||
        payload.idempotency_key !== idempotencyKey
      ) {
        throw httpError(403, "Mã xác thực OTP không hợp lệ");
      }

      req.otpUser = payload;
      next();
    } catch (e) {
      if (e.statusCode) return next(e);
      next(httpError(403, "Xác thực OTP đã hết hạn, vui lòng thực hiện lại"));
    }
  },

  verifyPinToken(req, res, next) {
    try {
      const pinToken = req.headers["x-pin-token"];
      const idempotencyKey = req.headers["idempotency-key"];
      if (!pinToken || !idempotencyKey) {
        throw httpError(403, "Thiếu mã xác thực PIN của giao dịch");
      }

      const payload = tokenUtil.verifyPinToken(pinToken);
      if (
        !req.user ||
        payload.user_id !== req.user.user_id ||
        payload.idempotency_key !== idempotencyKey
      ) {
        throw httpError(403, "Mã xác thực PIN không hợp lệ");
      }
      next();
    } catch (e) {
      if (e.statusCode) return next(e);
      next(httpError(403, "Xác thực PIN đã hết hạn, vui lòng nhập lại PIN"));
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
        req.rawBody ?? "",
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

function createRefreshCookieVerifier(cookieName) {
  return (req, res, next) => {
    try {
      const dashboardOrigins = process.env.DASHBOARD_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
      if (!dashboardOrigins.includes(req.headers.origin)) {
        throw httpError(403, "Nguồn gửi yêu cầu không hợp lệ");
      }

      const refreshToken = getCookie(req, cookieName);
      if (!refreshToken) {
        throw httpError(401, "Thiếu thông tin xác thực");
      }

      req.user = tokenUtil.verifyRefreshToken(refreshToken);
      req.refreshToken = refreshToken;
      next();
    } catch (e) {
      handleTokenError(e, next);
    }
  };
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

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
  console.error("Lỗi xác thực không xác định:", e);
  const err = new Error("Lỗi xác thực");
  err.statusCode = 500;
  next(err);
}

module.exports = authMiddleware;