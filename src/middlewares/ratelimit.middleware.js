const rateLimit = require("express-rate-limit");

const createLimiter = ({ windowMs, limit, keyGenerator }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator && { keyGenerator }),
    handler: (req, res, next) => {
      const err = new Error("Bạn thao tác quá nhiều lần, vui lòng thử lại sau");
      err.statusCode = 429;
      next(err);
    },
  });

const byUser = (req) => String(req.user?.user_id ?? "anonymous");

const CONTACT_DAILY_LIMIT = 2000;
const contactUsage = new Map();
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const currentDay = () =>
  new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);

setInterval(
  () => {
    const today = currentDay();
    for (const [userId, entry] of contactUsage) {
      if (entry.day !== today) contactUsage.delete(userId);
    }
  },
  60 * 60 * 1000,
).unref();

const contactDailyQuota = (req, res, next) => {
  const userId = req.user?.user_id;
  const phones = req.body?.phones;
  if (!userId || !Array.isArray(phones)) return next();

  const today = currentDay();
  let entry = contactUsage.get(userId);
  if (!entry || entry.day !== today) {
    entry = { day: today, hashes: new Set() };
    contactUsage.set(userId, entry);
  }

  const fresh = new Set();
  for (const p of phones) {
    const key = String(p).slice(0, 16);
    if (!entry.hashes.has(key)) fresh.add(key);
  }

  if (entry.hashes.size + fresh.size > CONTACT_DAILY_LIMIT) {
    const err = new Error(
      "Bạn đã tra cứu danh bạ quá nhiều hôm nay, vui lòng thử lại vào ngày mai",
    );
    err.statusCode = 429;
    return next(err);
  }

  fresh.forEach((key) => entry.hashes.add(key));
  next();
};

module.exports = {
  loginLimiter: createLimiter({ windowMs: 15 * 60 * 1000, limit: 20 }),
  otpLimiter: createLimiter({ windowMs: 5 * 60 * 1000, limit: 20 }),
  sendOtpLimiter: createLimiter({ windowMs: 5 * 60 * 1000, limit: 5 }),
  contactCheckLimiter: createLimiter({
    windowMs: 60 * 1000,
    limit: 5,
    keyGenerator: byUser,
  }),
  findUserLimiter: createLimiter({
    windowMs: 60 * 1000,
    limit: 10,
    keyGenerator: byUser,
  }),
  contactDailyQuota,
  transactionLimiter: createLimiter({
    windowMs: 60 * 1000,
    limit: 10,
    keyGenerator: byUser,
  }),
  resetApiKey: createLimiter({
    windowMs: 7 * 24 * 60 * 60 * 1000,
    limit: 1,
  }),
  resetSecretKey: createLimiter({
    windowMs: 7 * 24 * 60 * 60 * 1000,
    limit: 1,
  }),

  updatePin: createLimiter({
    windowMs: 7 * 24 * 60 * 60 * 1000,
    limit: 1,
    keyGenerator: byUser,
  }),
  updatePassWord: createLimiter({
    windowMs: 7 * 24 * 60 * 60 * 1000,
    limit: 1,
    keyGenerator: byUser,
  }),
};
