const express = require("express");
const path = require("path");
const rateLimit = require("express-rate-limit");
const paymentPageController = require("./paymentPage.controller");

// Trang này công khai (khách chưa đăng nhập) nên giới hạn tần suất theo IP.
// Trang tự hỏi trạng thái mỗi ~2,5 giây (~24 lần/phút), 120/phút là dư dả.
const payPageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const err = new Error("Bạn thao tác quá nhiều lần, vui lòng thử lại sau");
    err.statusCode = 429;
    next(err);
  },
});

// CSP riêng cho trang thanh toán: chỉ cho chạy script của chính server,
// và không chứa "upgrade-insecure-requests" (mặc định của helmet) để chạy được cả khi test qua http.
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/* Trang HTML: GET /pay/:referenceCode  (gắn trong server.js) */
const pageRouter = express.Router();
pageRouter.get("/assets/pay.js", (req, res) => {
  res.sendFile(path.join(__dirname, "pay.js"));
});
pageRouter.get("/:referenceCode", (req, res) => {
  res.setHeader("Content-Security-Policy", PAGE_CSP);
  res.setHeader("Cache-Control", "no-store");
  // Link thanh toán là bí mật: không để lọt qua Referer hay bị công cụ tìm kiếm lập chỉ mục.
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.sendFile(path.join(__dirname, "pay.html"));
});

/* API cho trang: GET /api/v2/pay/:referenceCode  (gắn trong routes/index.js) */
const apiRouter = express.Router();
apiRouter.get(
  "/:referenceCode",
  payPageLimiter,
  paymentPageController.getPaymentForPage,
);

module.exports = { pageRouter, apiRouter };