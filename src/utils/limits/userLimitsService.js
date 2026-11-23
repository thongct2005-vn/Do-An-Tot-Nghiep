// userLimitsService.js: Logic xem, cập nhật và đặt lại hạn mức giao dịch + sức chứa ví dùng chung cho User và Merchant.
const { uuidv7 } = require("uuidv7");
const pool = require("../../config/database");
const { httpError } = require("../common/http");
const { formatVnd, parseAmount } = require("../common/amount");
const { getDailyUsed } = require("./dailyLimit");
const {
  getTransactionPolicy,
  getEffectiveTransactionLimit,
  getEffectiveWalletCapacity,
} = require("./limitsDb");

const CONFIGURABLE_LIMIT_TYPES = Object.freeze(["TRANSFER", "WITHDRAW", "TOPUP"]);

async function fetchTransactionLimits({
  userId,
  role = "USER",
  userRepository,
  includeSummary = false,
  getSummaryFn = null,
}) {
  if (!userId) {
    throw httpError(
      400,
      includeSummary
        ? "Thiếu thông tin để lấy hạn mức giao dịch"
        : "Thiếu thông tin người dùng",
    );
  }

  const normalizedRole = role === "MERCHANT" ? "MERCHANT" : "USER";
  const user = await userRepository.getCredentialState(userId);
  if (
    !includeSummary &&
    (!user || user.status !== "ACTIVE" || user.role !== normalizedRole)
  ) {
    throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
  }

  const [summary, cap] = await Promise.all([
    includeSummary && getSummaryFn
      ? getSummaryFn(pool, { userId, role: normalizedRole })
      : Promise.resolve(null),
    getEffectiveWalletCapacity(pool, { userId, role: normalizedRole }),
  ]);

  const currentBalance = Number(user?.balance || 0);
  const items = [];

  for (const transactionType of CONFIGURABLE_LIMIT_TYPES) {
    const rule = await getEffectiveTransactionLimit(pool, {
      userId,
      role: normalizedRole,
      transactionType,
    });
    const dailyUsed = await getDailyUsed(pool, userId, transactionType);
    const effectiveDaily =
      rule.dailyLimit == null ? null : Number(rule.dailyLimit);
    const dailyRemaining =
      effectiveDaily == null ? null : Math.max(0, effectiveDaily - dailyUsed);

    items.push({
      transaction_type: transactionType,
      min_amount: Number(rule.system.min),
      system_max_amount: Number(rule.system.max),
      system_daily_limit:
        rule.system.dailyLimit == null
          ? Number(rule.system.max)
          : Number(rule.system.dailyLimit),
      max_amount: Number(rule.max),
      daily_limit:
        effectiveDaily == null ? Number(rule.system.max) : effectiveDaily,
      is_custom: Boolean(rule.custom),
      daily_used: dailyUsed,
      daily_remaining: dailyRemaining,
    });
  }

  const payload = {
    wallet_capacity: {
      current_balance: currentBalance,
      min_capacity: cap.minCapacity,
      default_capacity: cap.defaultCapacity,
      max_capacity: cap.maxCapacity,
      effective_capacity: cap.effectiveCapacity,
      remaining_capacity: Math.max(
        0,
        cap.effectiveCapacity - currentBalance,
      ),
      is_custom: cap.isCustom,
    },
    limits: items,
  };

  return summary ? { ...summary, ...payload } : payload;
}

async function updateUserTransactionLimit({
  userId,
  transactionType,
  maxAmount,
  dailyLimit,
  role = "USER",
  userRepository,
  validateActiveRole = true,
  includeSummary = false,
  getSummaryFn = null,
}) {
  if (!userId) {
    throw httpError(400, "Thiếu thông tin người dùng");
  }
  const normalizedRole = role === "MERCHANT" ? "MERCHANT" : "USER";
  const type = String(transactionType || "").trim().toUpperCase();

  if (validateActiveRole) {
    const user = await userRepository.getCredentialState(userId);
    if (!user || user.status !== "ACTIVE" || user.role !== normalizedRole) {
      throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
    }
  }

  if (type === "WALLET_CAPACITY") {
    const cap = await getEffectiveWalletCapacity(pool, {
      userId,
      role: normalizedRole,
    });
    const capNum = parseAmount(maxAmount);
    if (capNum < cap.minCapacity || capNum > cap.maxCapacity) {
      throw httpError(
        400,
        `Sức chứa ví phải từ ${formatVnd(cap.minCapacity)} đến ${formatVnd(cap.maxCapacity)}`,
      );
    }
    if (capNum === cap.defaultCapacity) {
      await userRepository.deleteUserTransactionLimit({
        userId,
        transactionType: "WALLET_CAPACITY",
      });
    } else {
      await userRepository.upsertUserTransactionLimit({
        id: uuidv7(),
        userId,
        transactionType: "WALLET_CAPACITY",
        maxAmount: capNum,
        dailyLimit: capNum,
      });
    }
    return fetchTransactionLimits({
      userId,
      role: normalizedRole,
      userRepository,
      includeSummary,
      getSummaryFn,
    });
  }

  if (!CONFIGURABLE_LIMIT_TYPES.includes(type)) {
    throw httpError(400, "Loại giao dịch không hỗ trợ cấu hình hạn mức");
  }

  const sys = await getTransactionPolicy(normalizedRole, type, pool);
  const sysMin = Number(sys.min);
  const sysMax = Number(sys.max);
  const sysDaily = sys.dailyLimit == null ? sysMax : Number(sys.dailyLimit);

  const maxNum = parseAmount(maxAmount);
  const dailyNum = parseAmount(dailyLimit);

  if (maxNum < sysMin || maxNum > sysMax) {
    throw httpError(
      400,
      `Hạn mức mỗi lần phải từ ${formatVnd(sysMin)} đến ${formatVnd(sysMax)}`,
    );
  }
  if (dailyNum < sysMin || dailyNum > sysDaily) {
    throw httpError(
      400,
      `Hạn mức mỗi ngày phải từ ${formatVnd(sysMin)} đến ${formatVnd(sysDaily)}`,
    );
  }
  if (maxNum > dailyNum) {
    throw httpError(
      400,
      "Hạn mức mỗi lần không được lớn hơn hạn mức mỗi ngày",
    );
  }

  if (maxNum === sysMax && dailyNum === sysDaily) {
    await userRepository.deleteUserTransactionLimit({
      userId,
      transactionType: type,
    });
  } else {
    await userRepository.upsertUserTransactionLimit({
      id: uuidv7(),
      userId,
      transactionType: type,
      maxAmount: maxNum,
      dailyLimit: dailyNum,
    });
  }

  return fetchTransactionLimits({
    userId,
    role: normalizedRole,
    userRepository,
    includeSummary,
    getSummaryFn,
  });
}

async function resetUserTransactionLimit({
  userId,
  transactionType,
  role = "USER",
  userRepository,
  validateActiveRole = true,
  includeSummary = false,
  getSummaryFn = null,
}) {
  if (!userId) {
    throw httpError(400, "Thiếu thông tin người dùng");
  }
  const normalizedRole = role === "MERCHANT" ? "MERCHANT" : "USER";
  const type = String(transactionType || "").trim().toUpperCase();
  if (type !== "WALLET_CAPACITY" && !CONFIGURABLE_LIMIT_TYPES.includes(type)) {
    throw httpError(400, "Loại cấu hình không hợp lệ");
  }
  if (validateActiveRole) {
    const user = await userRepository.getCredentialState(userId);
    if (!user || user.status !== "ACTIVE" || user.role !== normalizedRole) {
      throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
    }
  }
  await userRepository.deleteUserTransactionLimit({
    userId,
    transactionType: type,
  });
  return fetchTransactionLimits({
    userId,
    role: normalizedRole,
    userRepository,
    includeSummary,
    getSummaryFn,
  });
}

module.exports = {
  CONFIGURABLE_LIMIT_TYPES,
  fetchTransactionLimits,
  updateUserTransactionLimit,
  resetUserTransactionLimit,
};

