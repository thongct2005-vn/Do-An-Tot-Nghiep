const tokenUtil = require("../utils/jwt");
const { httpError } = require("../utils/httpError");
const { computePinBinding } = require("../utils/pinBinding");
const { computeSignature, isSameSignature } = require("../utils/keys/secretKey");
const dashboardRepository = require("../modules/merchant/shared/dashboard/dashboard.repository");
const MERCHANT_TIMESTAMP_TOLERANCE = 5 * 60;

function buildMerchantSignedPayload(req) {
  return [
    req.method.toUpperCase(),
    req.originalUrl,
    req.headers["idempotency-key"] ?? "",
    req.rawBody ?? "",
  ].join("\n");
}

function createFirstLoginChangeTokenVerifier(expectedPurpose) {
  return (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      const bearerToken =
        typeof authHeader === "string" && authHeader.startsWith("Bearer ")
          ? authHeader.slice(7).trim()
          : "";
      const token =
        req.headers["x-change-password-token"] ||
        req.headers["x-otp-token"] ||
        bearerToken;
      if (!token) {
        throw httpError(401, "Thiếu mã phiên đổi mật khẩu lần đầu");
      }
      let payload;
      try {
        payload = tokenUtil.verifyOtpToken(token, expectedPurpose);
      } catch (e) {
        return handleTokenError(e, next, "first_login_change");
      }
      req.firstLoginUser = payload;
      req.otpUser = payload;
      next();
    } catch (e) {
      next(e);
    }
  };
}

const authMiddleware = {
  verifyAccessToken(req, res, next) {
    try {
      const authHeader = req.headers["authorization"];
      const accessToken = authHeader && authHeader.split(" ")[1];
      if (!accessToken) {
        const err = new Error(
          "Thiếu thông tin phiên đăng nhập, vui lòng đăng nhập lại",
        );
        err.statusCode = 401;
        throw err;
      }

      const decoded = tokenUtil.verifyAccessToken(accessToken);
      req.user = decoded;
      next();
    } catch (e) {
      handleTokenError(e, next, "access_session");
    }
  },

  verifyRefreshToken(req, res, next) {
    try {
      const { refresh_token } = req.body;
      if (!refresh_token) {
        const err = new Error("Thiếu mã làm mới phiên đăng nhập");
        err.statusCode = 401;
        throw err;
      }

      const decoded = tokenUtil.verifyRefreshToken(refresh_token);
      req.user = decoded;
      next();
    } catch (e) {
      handleTokenError(e, next, "refresh_session");
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
        const err = new Error("Thiếu mã phiên xác thực OTP đăng nhập");
        err.statusCode = 401;
        throw err;
      }
      req.otpUser = tokenUtil.verifyOtpToken(otpToken, "login_otp");
      next();
    } catch (e) {
      handleTokenError(e, next, "login_otp");
    }
  },

  verifyRegisterOtpToken(req, res, next) {
    try {
      const otpToken = req.headers["x-otp-token"];
      if (!otpToken) {
        const err = new Error("Thiếu mã phiên xác thực OTP đăng ký");
        err.statusCode = 401;
        throw err;
      }
      req.otpUser = tokenUtil.verifyOtpToken(otpToken, "register_otp");
      next();
    } catch (e) {
      handleTokenError(e, next, "register_otp");
    }
  },

  verifyForgotOtpToken(req, res, next) {
    try {
      const otpToken = req.headers["x-otp-token"];
      if (!otpToken) {
        throw httpError(401, "Thiếu mã phiên khôi phục mật khẩu");
      }
      req.otpUser = tokenUtil.verifyOtpToken(otpToken, "forgot_otp");
      next();
    } catch (e) {
      handleTokenError(e, next, "forgot_otp");
    }
  },

  verifyMerchantForgotOtpToken(req, res, next) {
    try {
      const otpToken = req.headers["x-otp-token"];
      if (!otpToken) {
        throw httpError(401, "Thiếu mã phiên khôi phục mật khẩu");
      }
      req.otpUser = tokenUtil.verifyOtpToken(otpToken, "merchant_forgot_otp");
      next();
    } catch (e) {
      handleTokenError(e, next, "merchant_forgot_otp");
    }
  },

  verifyMerchantChangePasswordOtpToken: verifyScopedOtpToken(
    "merchant_change_password_otp",
  ),
  verifyMerchantChangePasswordVerifiedToken: verifyScopedOtpToken(
    "merchant_change_password_verified",
  ),
  verifyMerchantChangeEmailOtpToken: verifyScopedOtpToken(
    "merchant_change_email_otp",
  ),
  verifyMerchantChangeEmailVerifiedToken: verifyScopedOtpToken(
    "merchant_change_email_verified",
  ),
  verifyMerchantChangeEmailConfirmOtpToken: verifyScopedOtpToken(
    "merchant_change_email_confirm_otp",
  ),
  verifyMerchantFirstLoginChangeToken: createFirstLoginChangeTokenVerifier(
    "merchant_first_login_change",
  ),

  verifyUserFirstLoginChangeToken: createFirstLoginChangeTokenVerifier(
    "user_first_login_change",
  ),

  verifyMerchantForgotResetTokens(req, res, next) {
    try {
      const otpToken = req.headers["x-otp-token"];
      const taxCodeToken = req.headers["x-tax-code-token"];
      if (!otpToken || !taxCodeToken) {
        throw httpError(
          401,
          "Thiếu thông tin xác thực đặt lại mật khẩu (X-Otp-Token và X-Tax-Code-Token)",
        );
      }

      let otpPayload;
      try {
        otpPayload = tokenUtil.verifyOtpToken(
          otpToken,
          "merchant_forgot_otp_verified",
        );
      } catch (e) {
        return handleTokenError(e, next, "merchant_forgot_otp");
      }

      let taxCodePayload;
      try {
        taxCodePayload = tokenUtil.verifyTaxCodeToken(taxCodeToken);
      } catch (e) {
        return handleTokenError(e, next, "merchant_forgot_tax");
      }

      if (
        !otpPayload.user_id ||
        otpPayload.user_id !== taxCodePayload.user_id ||
        !otpPayload.pv ||
        otpPayload.pv !== taxCodePayload.pv
      ) {
        throw httpError(403, "Mã xác thực không khớp hoặc không hợp lệ");
      }

      req.resetUser = {
        user_id: otpPayload.user_id,
        pv: otpPayload.pv,
        tax_code_hash: taxCodePayload.tax_code_hash,
      };
      next();
    } catch (e) {
      handleTokenError(e, next, "merchant_forgot_otp");
    }
  },

  verifyPinChallengeToken(req, res, next) {
    try {
      const otpToken = req.headers["x-otp-token"];
      if (!otpToken) {
        throw httpError(401, "Thiếu thông tin xác thực bổ sung");
      }
      const payload = tokenUtil.verifyOtpToken(otpToken, "pin_challenge");
      if (req.user && payload.user_id !== req.user.user_id) {
        throw httpError(403, "Mã phiên xác thực bổ sung không hợp lệ");
      }
      req.otpUser = payload;
      next();
    } catch (e) {
      handleTokenError(e, next, "pin_challenge");
    }
  },

  verifyForgotKycToken(req, res, next) {
    try {
      const token = req.headers["x-forgot-token"];
      if (!token) {
        throw httpError(401, "Thiếu mã phiên xác thực định danh");
      }
      req.forgotUser = tokenUtil.verifyForgotKycToken(token);
      next();
    } catch (e) {
      handleTokenError(e, next, "forgot_kyc");
    }
  },

  // purpose: "reset_password" | "reset_pin"
  verifyResetToken(purpose) {
    const contextKey =
      purpose === "reset_password"
        ? "reset_password"
        : purpose === "reset_pin"
          ? "reset_pin"
          : "reset_default";
    const missingMessage =
      purpose === "reset_password"
        ? "Thiếu mã phiên đặt lại mật khẩu"
        : purpose === "reset_pin"
          ? "Thiếu mã phiên đặt lại mã PIN"
          : "Thiếu mã phiên đặt lại thông tin";

    return (req, res, next) => {
      try {
        const token = req.headers["x-reset-token"];
        if (!token) {
          throw httpError(401, missingMessage);
        }
        req.resetUser = tokenUtil.verifyResetToken(token, purpose);
        next();
      } catch (e) {
        handleTokenError(e, next, contextKey);
      }
    };
  },

  // OTP token chỉ có giá trị cho đúng loại giao dịch (action) và đúng nội dung request
  // (số tiền, người nhận, ngân hàng...) đã được ký vào token lúc verify OTP.
  verifyTransactionOtpToken(action) {
    return (req, res, next) => {
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
          payload.idempotency_key !== idempotencyKey ||
          payload.action !== action
        ) {
          throw httpError(403, "Mã xác thực OTP không hợp lệ");
        }

        let expectedBinding;
        try {
          expectedBinding = computePinBinding(action, req.body);
        } catch (_) {
          throw httpError(403, "Mã xác thực OTP không khớp với giao dịch");
        }
        if (!payload.binding || payload.binding !== expectedBinding) {
          throw httpError(403, "Mã xác thực OTP không khớp với giao dịch");
        }

        req.otpUser = payload;
        next();
      } catch (e) {
        handleTokenError(e, next, "transaction_otp");
      }
    };
  },

  // PIN token chỉ có giá trị cho đúng loại giao dịch (action) và đúng nội dung request
  // (số tiền, người nhận...) đã được ký vào token lúc checkPin.
  requirePinToken(action) {
    return (req, res, next) => {
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
          payload.idempotency_key !== idempotencyKey ||
          payload.action !== action
        ) {
          throw httpError(403, "Mã xác thực PIN không hợp lệ");
        }

        let expectedBinding;
        try {
          expectedBinding = computePinBinding(action, req.body);
        } catch (_) {
          throw httpError(403, "Mã xác thực PIN không khớp với giao dịch");
        }
        if (!payload.binding || payload.binding !== expectedBinding) {
          throw httpError(403, "Mã xác thực PIN không khớp với giao dịch");
        }
        next();
      } catch (e) {
        handleTokenError(e, next, "transaction_pin");
      }
    };
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
        throw httpError(401, "Yêu cầu đã hết hạn hoặc thời gian không hợp lệ");
      }

      const merchant =
        await dashboardRepository.getMerchantInfoByApiKey(apiKey);
      if (!merchant) {
        throw httpError(401, "API Key không hợp lệ");
      }

      if (merchant.credentials_revoked || !merchant.secret_key) throw httpError(403, 'Khóa tích hợp đã bị thu hồi hoặc chưa cấu hình. Vui lòng liên hệ quản trị viên.');
      const expected = computeSignature(
        merchant.secret_key,
        timestamp,
        buildMerchantSignedPayload(req),
      );
      // Chỉ chấp nhận chữ ký kiểu mới (ký cả method, đường dẫn, Idempotency-Key và body)
      if (!isSameSignature(signature, expected)) {
        throw httpError(401, "Chữ ký không hợp lệ");
      }

      // Kiểm tra sau khi chữ ký đúng để người lạ không dò được trạng thái tài khoản.
      if (merchant.role !== "MERCHANT" || merchant.status !== "ACTIVE") {
        throw httpError(403, "Tài khoản merchant đang bị khoá hoặc không khả dụng");
      }

      const { secret_key: _secretKey, ...safeMerchant } = merchant;
      req.merchant = safeMerchant;
      next();
    } catch (e) {
      handleTokenError(e, next);
    }
  },

  async requireActiveMerchant(req, res, next) {
    try {
      if (req.user?.type !== "MERCHANT" || !req.user.user_id) {
        throw httpError(403, "Bạn không có quyền truy cập chức năng này");
      }
      const merchant = await dashboardRepository.getMerchantAccountStatus(req.user.user_id);
      if (!merchant || merchant.role !== "MERCHANT" || merchant.status !== "ACTIVE") {
        throw httpError(403, "Tài khoản merchant đang bị khoá hoặc không khả dụng");
      }
      if (merchant.must_change_password === true) {
        throw httpError(403, "Vui lòng đổi mật khẩu tạm thời và đăng nhập lại trước khi sử dụng");
      }
      next();
    } catch (error) {
      next(error);
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
        throw httpError(401, "Thiếu mã làm mới phiên đăng nhập");
      }

      req.user = tokenUtil.verifyRefreshToken(refreshToken);
      req.refreshToken = refreshToken;
      next();
    } catch (e) {
      handleTokenError(e, next, "refresh_session");
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

function verifyScopedOtpToken(purpose) {
  return (req, res, next) => {
    try {
      const otpToken = req.headers["x-otp-token"];
      if (!otpToken) {
        throw httpError(403, "Thiếu thông tin xác thực OTP");
      }
      let payload;
      try {
        payload = tokenUtil.verifyOtpToken(otpToken, purpose);
      } catch (e) {
        return handleTokenError(e, next, "scoped_otp");
      }
      if (req.user && payload.user_id !== req.user.user_id) {
        throw httpError(403, "Mã xác thực OTP không hợp lệ");
      }
      req.otpUser = payload;
      next();
    } catch (e) {
      next(e);
    }
  };
}

const TOKEN_ERROR_CONTEXTS = {
  access_session: {
    statusCode: 401,
    expiredMessage: "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại",
    invalidMessage: "Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại",
  },
  refresh_session: {
    statusCode: 401,
    expiredMessage: "Phiên làm mới đăng nhập đã hết hạn, vui lòng đăng nhập lại",
    invalidMessage: "Phiên làm mới đăng nhập không hợp lệ, vui lòng đăng nhập lại",
  },
  first_login_change: {
    statusCode: 401,
    expiredMessage: "Phiên đổi mật khẩu lần đầu đã hết hạn, vui lòng đăng nhập lại",
    invalidMessage: "Phiên đổi mật khẩu lần đầu không hợp lệ",
  },
  login_otp: {
    statusCode: 401,
    expiredMessage: "Phiên xác thực OTP đăng nhập đã hết hạn, vui lòng đăng nhập lại",
    invalidMessage: "Phiên xác thực OTP đăng nhập không hợp lệ",
  },
  register_otp: {
    statusCode: 401,
    expiredMessage: "Phiên xác thực OTP đăng ký đã hết hạn, vui lòng thực hiện lại",
    invalidMessage: "Phiên xác thực OTP đăng ký không hợp lệ",
  },
  forgot_otp: {
    statusCode: 401,
    expiredMessage: "Phiên xác thực OTP khôi phục mật khẩu đã hết hạn, vui lòng thử lại",
    invalidMessage: "Phiên xác thực OTP khôi phục mật khẩu không hợp lệ",
  },
  merchant_forgot_otp: {
    statusCode: 401,
    expiredMessage: "Phiên xác thực OTP khôi phục mật khẩu đã hết hạn, vui lòng thử lại",
    invalidMessage: "Phiên xác thực OTP khôi phục mật khẩu không hợp lệ",
  },
  merchant_forgot_tax: {
    statusCode: 401,
    expiredMessage: "Phiên xác thực mã số thuế đã hết hạn, vui lòng thử lại",
    invalidMessage: "Mã xác thực mã số thuế không hợp lệ",
  },
  pin_challenge: {
    statusCode: 401,
    expiredMessage: "Phiên xác thực bổ sung đã hết hạn, vui lòng thử lại",
    invalidMessage: "Mã phiên xác thực bổ sung không hợp lệ",
  },
  forgot_kyc: {
    statusCode: 401,
    expiredMessage: "Phiên xác thực định danh đã hết hạn, vui lòng thực hiện lại",
    invalidMessage: "Mã phiên xác thực định danh không hợp lệ",
  },
  reset_password: {
    statusCode: 401,
    expiredMessage: "Phiên đặt lại mật khẩu đã hết hạn, vui lòng thực hiện lại",
    invalidMessage: "Mã phiên đặt lại mật khẩu không hợp lệ",
  },
  reset_pin: {
    statusCode: 401,
    expiredMessage: "Phiên đặt lại mã PIN đã hết hạn, vui lòng thực hiện lại",
    invalidMessage: "Mã phiên đặt lại mã PIN không hợp lệ",
  },
  reset_default: {
    statusCode: 401,
    expiredMessage: "Phiên đặt lại thông tin đã hết hạn, vui lòng thực hiện lại",
    invalidMessage: "Mã phiên đặt lại thông tin không hợp lệ",
  },
  scoped_otp: {
    statusCode: 403,
    expiredMessage: "Phiên xác thực OTP đã hết hạn, vui lòng thử lại",
    invalidMessage: "Phiên xác thực OTP không hợp lệ",
  },
  transaction_otp: {
    statusCode: 403,
    expiredMessage: "Phiên xác thực OTP giao dịch đã hết hạn, vui lòng thực hiện lại",
    invalidMessage: "Mã xác thực OTP giao dịch không hợp lệ",
  },
  transaction_pin: {
    statusCode: 403,
    expiredMessage: "Phiên xác thực PIN giao dịch đã hết hạn, vui lòng nhập lại PIN",
    invalidMessage: "Mã xác thực PIN giao dịch không hợp lệ",
  },
};

function handleTokenError(e, next, contextKey = null) {
  if (e.statusCode) return next(e);
  const ctx =
    typeof contextKey === "string"
      ? TOKEN_ERROR_CONTEXTS[contextKey]
      : contextKey && typeof contextKey === "object"
        ? contextKey
        : null;
  const statusCode = ctx?.statusCode || 401;

  if (e.name === "TokenExpiredError") {
    const err = new Error(
      ctx?.expiredMessage || "Phiên xác thực đã hết hạn, vui lòng thực hiện lại",
    );
    err.statusCode = statusCode;
    return next(err);
  }
  if (e.name === "JsonWebTokenError" || e.name === "NotBeforeError") {
    const err = new Error(
      ctx?.invalidMessage || "Mã phiên xác thực không hợp lệ",
    );
    err.statusCode = statusCode;
    return next(err);
  }
  console.error("Lỗi xác thực không xác định:", e);
  const err = new Error("Lỗi xác thực hệ thống");
  err.statusCode = 500;
  next(err);
}

module.exports = authMiddleware;
