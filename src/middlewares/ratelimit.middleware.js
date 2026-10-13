const rateLimit = require("express-rate-limit");

const createLimiter = ({ windowMs, limit }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next) => {
      const err = new Error("Bạn thao tác quá nhiều lần, vui lòng thử lại sau");
      err.statusCode = 429;
      next(err);
    },
  });

module.exports = {
  loginLimiter: createLimiter({ windowMs: 15 * 60 * 1000, limit: 20 }),
  otpLimiter: createLimiter({ windowMs: 5 * 60 * 1000, limit: 20 }),
  sendOtpLimiter: createLimiter({ windowMs: 5 * 60 * 1000, limit: 5 }),
};
