// http.js: Tiện ích HTTP chuẩn hóa lỗi, phản hồi JSON và helper dùng chung cho controller.

const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const successResponse = (
  res,
  statusCode = 200,
  message = "Thành công",
  data = null,
) => {
  return res.status(statusCode).json({
    status: "success",
    code: statusCode,
    message: message,
    data: data,
  });
};

const errorResponse = (
  res,
  statusCode = 500,
  message = "Đã có lỗi xảy ra!",
  error = null,
) => {
  const result = {
    status: "error",
    code: statusCode,
    message: message,
  };

  if (error) {
    result.error = error;
  }

  return res.status(statusCode).json({ ...result });
};

function extractRawBody(req) {
  return Object.hasOwn(req, "rawBodyForRisk") ? req.rawBodyForRisk : req.body;
}

async function runWithRiskFailure(identifier, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.statusCode && err.statusCode < 500 && identifier) {
      const { recordFailure } = require("../security/risk");
      recordFailure(identifier);
    }
    throw err;
  }
}

function createRefreshCookieHelpers({
  cookieName,
  path,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
}) {
  const baseOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path,
  };

  return {
    setRefreshCookie(res, refreshToken) {
      res.cookie(cookieName, refreshToken, {
        ...baseOptions,
        maxAge: maxAgeMs,
      });
    },
    clearRefreshCookie(res) {
      res.clearCookie(cookieName, baseOptions);
    },
    publicToken(token) {
      return { access_token: token?.access_token };
    },
  };
}

module.exports = {
  httpError,
  successResponse,
  errorResponse,
  extractRawBody,
  runWithRiskFailure,
  createRefreshCookieHelpers,
};

