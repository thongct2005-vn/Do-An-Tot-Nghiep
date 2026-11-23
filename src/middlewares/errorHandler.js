const { errorResponse } = require("../utils/common/http");
require("dotenv").config();

const MAX_ORIGIN_LENGTH = 160;
const MAX_UA_LENGTH = 120;

function sanitizeLogField(value, maxLength) {
  if (value === undefined || value === null) return "-";
  const cleaned = String(value)
    .replace(/[\r\n\u0000-\u001F\u007F]+/g, " ")
    .trim();
  if (!cleaned) return "-";
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}...`
    : cleaned;
}

function stripQueryString(rawUrl) {
  const value = typeof rawUrl === "string" ? rawUrl : "";
  return value.split("?", 1)[0];
}

function readHeader(req, name) {
  if (typeof req.get === "function") return req.get(name);
  return req.headers?.[name.toLowerCase()];
}

function formatErrorLog(req, statusCode, message) {
  const safePath = sanitizeLogField(
    stripQueryString(req.originalUrl || req.url || ""),
    255,
  );
  const rawOrigin = readHeader(req, "origin");
  const rawReferer = readHeader(req, "referer");
  const origin = sanitizeLogField(
    rawOrigin || stripQueryString(rawReferer),
    MAX_ORIGIN_LENGTH,
  );
  const ip = sanitizeLogField(req.ip || req.socket?.remoteAddress, 64);
  const ua = sanitizeLogField(readHeader(req, "user-agent"), MAX_UA_LENGTH);
  const safeMessage = sanitizeLogField(message, 255);
  return `[${statusCode}] ${req.method} ${safePath} - ${safeMessage} origin=${origin} ip=${ip} ua=${ua}`;
}

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Lỗi không xác định";
  let errorDetail = null;

  if (statusCode === 500) {
    console.log(err.stack);
  } else {
    res.locals.errorMessage = message;
  }

  if (err.code === "23505") {
    statusCode = 400;
    message = "Dữ liệu đã tồn tại";
  }

  const environment = process.env.NODE_ENV || "";

  if (environment === "development") {
    errorDetail = err.stack;
  } else {
    if (statusCode === 500) {
      message = "Hệ thống đang bảo trì!";
    }
  }

  return errorResponse(res, statusCode, message, errorDetail);
};

module.exports = errorHandler;
module.exports.formatErrorLog = formatErrorLog;
module.exports.sanitizeLogField = sanitizeLogField;
