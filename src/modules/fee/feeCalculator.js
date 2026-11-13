const { httpError } = require("../../utils/httpError");

const SYSTEM_FEE_WALLET_ID = "00000000-0000-7000-8000-000000000001";
const SYSTEM_FEE_WALLET_PHONE = "SYS_FEE_01";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const FEE_TYPES = Object.freeze({
  QR_FEE: "QR_FEE",
  USER_FEE: "USER_FEE",
  WITHDRAW_FEE: "WITHDRAW_FEE",
  MONTHLY_PLAN_FEE: "MONTHLY_PLAN_FEE",
});

const MONTHLY_STATUS = Object.freeze({
  INACTIVE: "INACTIVE",
  ACTIVE: "ACTIVE",
  PENDING_ACTIVATE: "PENDING_ACTIVATE",
  PAST_DUE: "PAST_DUE",
});

const DEFAULT_MERCHANT_FEE_TIERS = Object.freeze([
  Object.freeze({ from_amount: 0, rate_bps: 100 }),
  Object.freeze({ from_amount: 50_000_000, rate_bps: 80 }),
  Object.freeze({ from_amount: 200_000_000, rate_bps: 60 }),
]);

const DEFAULT_MERCHANT_FEE_CONFIG = Object.freeze({
  rate_bps: 100,
  min_fee: 200,
  max_fee: null,
  max_fee_unbounded: true,
  free_threshold_amount: 0,
  transfer_fee_bps: 0,
  transfer_min_fee: 0,
  transfer_max_fee: null,
  transfer_max_fee_unbounded: true,
  withdraw_fee_bps: 50,
  withdraw_free_quota_per_month: 50_000_000,
  monthly_plan_enabled: false,
  monthly_plan_fee: 0,
  monthly_grace_days: 7,
  tiers: DEFAULT_MERCHANT_FEE_TIERS,
});

const DEFAULT_USER_FEE_CONFIG = Object.freeze({
  rate_bps: 0,
  min_fee: 0,
  max_fee: null,
  max_fee_unbounded: true,
  free_threshold_amount: 0,
  transfer_fee_bps: 0,
  transfer_min_fee: 0,
  transfer_max_fee: null,
  transfer_max_fee_unbounded: true,
  withdraw_fee_bps: 0,
  withdraw_free_quota_per_month: 0,
  monthly_plan_enabled: false,
  monthly_plan_fee: 0,
  monthly_grace_days: 7,
  tiers: [],
});

function parseStrictNonNegativeInt(raw, fieldName) {
  if (raw === undefined || raw === null || typeof raw === "boolean") {
    throw httpError(400, `${fieldName} phải là số nguyên không âm`);
  }
  const num =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  if (!Number.isSafeInteger(num) || num < 0) {
    throw httpError(400, `${fieldName} phải là số nguyên không âm`);
  }
  return num;
}

function assertPositiveIntegerAmount(raw, fieldName = "Số tiền giao dịch") {
  if (raw === undefined || raw === null || typeof raw === "boolean") {
    throw httpError(400, `${fieldName} phải là số nguyên dương lớn hơn 0`);
  }
  const num =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw httpError(400, `${fieldName} phải là số nguyên dương lớn hơn 0`);
  }
  return num;
}

function percentToBpsStrict(rawPercent, fieldName = "Tỉ lệ phí (%)") {
  if (rawPercent === undefined || rawPercent === null || typeof rawPercent === "boolean") {
    throw httpError(400, `${fieldName} không hợp lệ`);
  }
  const num = typeof rawPercent === "string" && rawPercent.trim() !== ""
    ? Number(rawPercent.trim())
    : typeof rawPercent === "number"
      ? rawPercent
      : NaN;
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw httpError(400, `${fieldName} phải nằm trong khoảng 0 đến 100`);
  }
  const scaled = num * 100;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw httpError(
      400,
      `${fieldName} chỉ hỗ trợ tối đa 2 chữ số thập phân (bội số 0.01%)`,
    );
  }
  return rounded;
}

function normalizeRateBps(bpsRaw, percentRaw, fieldName = "rate_bps") {
  const hasBps = bpsRaw !== undefined && bpsRaw !== null;
  const hasPercent = percentRaw !== undefined && percentRaw !== null;
  if (!hasBps && !hasPercent) return undefined;

  let bpsFromBps;
  if (hasBps) {
    if (typeof bpsRaw === "boolean") {
      throw httpError(400, `${fieldName} không hợp lệ`);
    }
    const num =
      typeof bpsRaw === "number"
        ? bpsRaw
        : typeof bpsRaw === "string" && /^\d+$/.test(bpsRaw.trim())
          ? Number(bpsRaw.trim())
          : NaN;
    if (!Number.isSafeInteger(num) || num < 0 || num > 10_000) {
      throw httpError(400, `${fieldName} phải là số nguyên trong khoảng 0..10000 (0%..100%)`);
    }
    bpsFromBps = num;
  }

  let bpsFromPercent;
  if (hasPercent) {
    bpsFromPercent = percentToBpsStrict(percentRaw, fieldName);
  }

  if (hasBps && hasPercent && bpsFromBps !== bpsFromPercent) {
    throw httpError(400, `${fieldName} và phần trăm tương ứng không khớp nhau`);
  }
  return hasBps ? bpsFromBps : bpsFromPercent;
}

function normalizeTiersInput(rawTiers) {
  if (rawTiers === undefined || rawTiers === null) {
    return [];
  }
  if (!Array.isArray(rawTiers)) {
    throw httpError(400, "tiers phải là mảng");
  }
  const mapped = rawTiers.map((item, idx) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw httpError(400, `tiers[${idx}] không hợp lệ`);
    }
    const fromAmount = parseStrictNonNegativeInt(
      item.from_amount ?? item.from ?? 0,
      `tiers[${idx}].from_amount`,
    );
    const rateBps = normalizeRateBps(
      item.rate_bps,
      item.rate_percent ?? item.rate,
      `tiers[${idx}].rate`,
    );
    if (rateBps === undefined) {
      throw httpError(400, `tiers[${idx}] thiếu rate_bps hoặc rate_percent`);
    }
    return {
      from_amount: fromAmount,
      rate_bps: rateBps,
      rate_percent: Number((rateBps / 100).toFixed(2)),
    };
  });

  mapped.sort((a, b) => a.from_amount - b.from_amount);
  for (let i = 1; i < mapped.length; i += 1) {
    if (mapped[i].from_amount === mapped[i - 1].from_amount) {
      throw httpError(400, `tiers bị trùng mốc from_amount = ${mapped[i].from_amount}`);
    }
  }
  return mapped;
}

function coerceStoredTiers(rawTiers, fallbackTiers = []) {
  const source = rawTiers !== undefined ? rawTiers : fallbackTiers;
  if (!Array.isArray(source)) {
    return fallbackTiers.map((t) => ({
      from_amount: Number(t.from_amount),
      rate_bps: Number(t.rate_bps),
      rate_percent: Number((Number(t.rate_bps) / 100).toFixed(2)),
    }));
  }
  return source
    .map((item) => {
      const fromAmount = Math.max(0, Math.trunc(Number(item?.from_amount ?? item?.from ?? 0) || 0));
      const rateBps = Math.max(
        0,
        Math.min(10_000, Math.trunc(Number(item?.rate_bps ?? 0) || 0)),
      );
      return {
        from_amount: fromAmount,
        rate_bps: rateBps,
        rate_percent: Number((rateBps / 100).toFixed(2)),
      };
    })
    .sort((a, b) => a.from_amount - b.from_amount);
}

/**
 * Chuẩn hóa raw JSON từ system_configs (hỗ trợ cả định dạng mới phẳng và định dạng cũ PER_TRANSACTION/MONTHLY).
 */
function normalizeSystemFeeConfig(raw, role = "MERCHANT") {
  const normalizedRole = String(role || "").toUpperCase();
  const fallback =
    normalizedRole === "USER"
      ? DEFAULT_USER_FEE_CONFIG
      : DEFAULT_MERCHANT_FEE_CONFIG;
  const src = raw && typeof raw === "object" ? raw : {};
  const legacyPerTx = src.PER_TRANSACTION && typeof src.PER_TRANSACTION === "object" ? src.PER_TRANSACTION : {};
  const legacyMonthly = src.MONTHLY && typeof src.MONTHLY === "object" ? src.MONTHLY : {};

  const rateBpsRaw = src.rate_bps ?? legacyPerTx.percent_bps ?? fallback.rate_bps;
  const rateBps = Math.max(0, Math.min(10_000, Math.trunc(Number(rateBpsRaw ?? fallback.rate_bps) || 0)));

  const minFee = Math.max(
    0,
    Math.trunc(Number(src.min_fee ?? legacyPerTx.min_fee ?? fallback.min_fee) || 0),
  );

  const explicitMaxRaw =
    src.max_fee !== undefined
      ? src.max_fee
      : legacyPerTx.max_fee !== undefined
        ? legacyPerTx.max_fee
        : fallback.max_fee;

  const maxFee =
    explicitMaxRaw === null
      ? null
      : Math.max(minFee, Math.trunc(Number(explicitMaxRaw) || 0));
  const maxFeeUnbounded = maxFee === null;

  const freeThresholdAmount = Math.max(
    0,
    Math.trunc(Number(src.free_threshold_amount ?? fallback.free_threshold_amount) || 0),
  );

  const transferFeeBps = Math.max(
    0,
    Math.min(10_000, Math.trunc(Number(src.transfer_fee_bps ?? fallback.transfer_fee_bps) || 0)),
  );
  const transferMinFee = Math.max(
    0,
    Math.trunc(Number(src.transfer_min_fee ?? fallback.transfer_min_fee) || 0),
  );
  const explicitTransferMaxRaw =
    src.transfer_max_fee !== undefined
      ? src.transfer_max_fee
      : fallback.transfer_max_fee;
  const transferMaxFee =
    explicitTransferMaxRaw === null
      ? null
      : Math.max(transferMinFee, Math.trunc(Number(explicitTransferMaxRaw) || 0));
  const transferMaxFeeUnbounded = transferMaxFee === null;

  const withdrawFeeBps = Math.max(
    0,
    Math.min(10_000, Math.trunc(Number(src.withdraw_fee_bps ?? fallback.withdraw_fee_bps) || 0)),
  );
  const withdrawFreeQuotaPerMonth = Math.max(
    0,
    Math.trunc(
      Number(src.withdraw_free_quota_per_month ?? fallback.withdraw_free_quota_per_month) || 0,
    ),
  );
  const monthlyPlanEnabled = Boolean(
    src.monthly_plan_enabled ?? fallback.monthly_plan_enabled,
  );
  const monthlyPlanFee = Math.max(
    0,
    Math.trunc(
      Number(src.monthly_plan_fee ?? legacyMonthly.monthly_fee ?? fallback.monthly_plan_fee) || 0,
    ),
  );
  const monthlyGraceDays = Math.max(
    0,
    Math.min(31, Math.trunc(Number(src.monthly_grace_days ?? fallback.monthly_grace_days) || 0)),
  );

  const hasExplicitCustomRateWithoutTiers =
    src.tiers === undefined &&
    src.rate_bps !== undefined &&
    Number(src.rate_bps) !== fallback.rate_bps;
  const tiers = hasExplicitCustomRateWithoutTiers
    ? []
    : coerceStoredTiers(src.tiers, fallback.tiers);

  return {
    rate_bps: rateBps,
    rate_percent: Number((rateBps / 100).toFixed(2)),
    min_fee: minFee,
    max_fee: maxFee,
    max_fee_unbounded: maxFeeUnbounded,
    free_threshold_amount: freeThresholdAmount,
    transfer_fee_bps: transferFeeBps,
    transfer_fee_percent: Number((transferFeeBps / 100).toFixed(2)),
    transfer_min_fee: transferMinFee,
    transfer_max_fee: transferMaxFee,
    transfer_max_fee_unbounded: transferMaxFeeUnbounded,
    withdraw_fee_bps: withdrawFeeBps,
    withdraw_fee_percent: Number((withdrawFeeBps / 100).toFixed(2)),
    withdraw_free_quota_per_month: withdrawFreeQuotaPerMonth,
    monthly_plan_enabled: monthlyPlanEnabled,
    monthly_plan_fee: monthlyPlanFee,
    monthly_grace_days: monthlyGraceDays,
    tiers,
    PER_TRANSACTION: {
      percent_bps: rateBps,
      min_fee: minFee,
      max_fee: maxFee,
    },
    MONTHLY: {
      monthly_fee: monthlyPlanFee,
    },
  };
}

/**
 * Validate dữ liệu đầu vào khi Admin API / CLI cập nhật cấu hình mặc định hoặc riêng theo merchant.
 */
function validateFeeConfigInput(
  input,
  { isOverride = false, now = new Date(), baseConfig = null } = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpError(400, "Dữ liệu cấu hình phí không hợp lệ");
  }

  const normalized = {};

  if (
    input.rate_bps !== undefined ||
    input.rate_percent !== undefined
  ) {
    normalized.rate_bps =
      input.rate_bps === null && isOverride
        ? null
        : normalizeRateBps(input.rate_bps, input.rate_percent, "rate_percent / rate_bps");
  }

  if (input.min_fee !== undefined) {
    normalized.min_fee =
      input.min_fee === null && isOverride
        ? null
        : parseStrictNonNegativeInt(input.min_fee, "min_fee");
  }

  if (input.max_fee_unbounded !== undefined) {
    if (typeof input.max_fee_unbounded !== "boolean") {
      throw httpError(400, "max_fee_unbounded phải là boolean");
    }
    normalized.max_fee_unbounded = input.max_fee_unbounded;
  }

  if (input.max_fee !== undefined) {
    if (input.max_fee === null) {
      normalized.max_fee = null;
      if (normalized.max_fee_unbounded === undefined) {
        normalized.max_fee_unbounded = true;
      }
    } else {
      normalized.max_fee = parseStrictNonNegativeInt(input.max_fee, "max_fee");
      if (normalized.max_fee_unbounded === undefined) {
        normalized.max_fee_unbounded = false;
      }
    }
  } else if (normalized.max_fee_unbounded === true) {
    normalized.max_fee = null;
  }

  if (input.free_threshold_amount !== undefined) {
    normalized.free_threshold_amount =
      input.free_threshold_amount === null && isOverride
        ? null
        : parseStrictNonNegativeInt(input.free_threshold_amount, "free_threshold_amount");
  }

  if (
    input.transfer_fee_bps !== undefined ||
    input.transfer_fee_percent !== undefined
  ) {
    normalized.transfer_fee_bps =
      input.transfer_fee_bps === null && isOverride
        ? null
        : normalizeRateBps(
            input.transfer_fee_bps,
            input.transfer_fee_percent,
            "transfer_fee_percent / transfer_fee_bps",
          );
  }

  if (input.transfer_min_fee !== undefined) {
    normalized.transfer_min_fee =
      input.transfer_min_fee === null && isOverride
        ? null
        : parseStrictNonNegativeInt(input.transfer_min_fee, "transfer_min_fee");
  }

  if (input.transfer_max_fee_unbounded !== undefined) {
    if (typeof input.transfer_max_fee_unbounded !== "boolean") {
      throw httpError(400, "transfer_max_fee_unbounded phải là boolean");
    }
    normalized.transfer_max_fee_unbounded = input.transfer_max_fee_unbounded;
  }

  if (input.transfer_max_fee !== undefined) {
    if (input.transfer_max_fee === null) {
      normalized.transfer_max_fee = null;
      if (normalized.transfer_max_fee_unbounded === undefined) {
        normalized.transfer_max_fee_unbounded = true;
      }
    } else {
      normalized.transfer_max_fee = parseStrictNonNegativeInt(
        input.transfer_max_fee,
        "transfer_max_fee",
      );
      if (normalized.transfer_max_fee_unbounded === undefined) {
        normalized.transfer_max_fee_unbounded = false;
      }
    }
  } else if (normalized.transfer_max_fee_unbounded === true) {
    normalized.transfer_max_fee = null;
  }

  if (
    input.withdraw_fee_bps !== undefined ||
    input.withdraw_fee_percent !== undefined
  ) {
    normalized.withdraw_fee_bps =
      input.withdraw_fee_bps === null && isOverride
        ? null
        : normalizeRateBps(
            input.withdraw_fee_bps,
            input.withdraw_fee_percent,
            "withdraw_fee_percent / withdraw_fee_bps",
          );
  }

  if (input.withdraw_free_quota_per_month !== undefined) {
    normalized.withdraw_free_quota_per_month =
      input.withdraw_free_quota_per_month === null && isOverride
        ? null
        : parseStrictNonNegativeInt(
            input.withdraw_free_quota_per_month,
            "withdraw_free_quota_per_month",
          );
  }

  if (input.monthly_plan_enabled !== undefined) {
    if (input.monthly_plan_enabled === null && isOverride) {
      normalized.monthly_plan_enabled = null;
    } else if (typeof input.monthly_plan_enabled === "boolean") {
      normalized.monthly_plan_enabled = input.monthly_plan_enabled;
    } else {
      throw httpError(400, "monthly_plan_enabled phải là boolean");
    }
  }

  if (input.monthly_plan_fee !== undefined) {
    normalized.monthly_plan_fee =
      input.monthly_plan_fee === null && isOverride
        ? null
        : parseStrictNonNegativeInt(input.monthly_plan_fee, "monthly_plan_fee");
  }

  if (input.monthly_grace_days !== undefined) {
    const graceDays = parseStrictNonNegativeInt(
      input.monthly_grace_days,
      "monthly_grace_days",
    );
    if (graceDays > 31) {
      throw httpError(400, "monthly_grace_days không được vượt quá 31 ngày");
    }
    normalized.monthly_grace_days = graceDays;
  }

  if (input.tiers !== undefined) {
    normalized.tiers = normalizeTiersInput(input.tiers);
  }

  if (isOverride) {
    const nowDate = now instanceof Date ? now : new Date(now);
    if (input.effective_from !== undefined && input.effective_from !== null && input.effective_from !== "") {
      const parsed = new Date(input.effective_from);
      if (Number.isNaN(parsed.getTime())) {
        throw httpError(400, "effective_from không đúng định dạng ngày giờ");
      }
      if (parsed.getTime() < nowDate.getTime()) {
        throw httpError(
          400,
          "effective_from không được ở quá khứ (không áp dụng hồi tố giao dịch cũ)",
        );
      }
      normalized.effective_from = parsed;
    } else {
      normalized.effective_from = nowDate;
    }
  }

  // Kiểm tra độc lập min_fee <= max_fee và transfer_min_fee <= transfer_max_fee
  if (
    normalized.min_fee !== undefined &&
    normalized.min_fee !== null &&
    normalized.max_fee !== undefined &&
    normalized.max_fee !== null &&
    normalized.min_fee > normalized.max_fee
  ) {
    throw httpError(400, "min_fee không được lớn hơn max_fee");
  }

  if (
    normalized.transfer_min_fee !== undefined &&
    normalized.transfer_min_fee !== null &&
    normalized.transfer_max_fee !== undefined &&
    normalized.transfer_max_fee !== null &&
    normalized.transfer_min_fee > normalized.transfer_max_fee
  ) {
    throw httpError(400, "transfer_min_fee không được lớn hơn transfer_max_fee");
  }

  // Kiểm tra sau khi gộp với cấu hình nền (nếu có)
  if (baseConfig) {
    const base = normalizeSystemFeeConfig(baseConfig);
    const mergedMin =
      normalized.min_fee !== undefined && normalized.min_fee !== null
        ? normalized.min_fee
        : base.min_fee;
    const isUnbounded =
      normalized.max_fee_unbounded === true ||
      (normalized.max_fee === undefined && base.max_fee === null);
    const mergedMax = isUnbounded
      ? null
      : normalized.max_fee !== undefined
        ? normalized.max_fee
        : base.max_fee;

    if (mergedMax !== null && mergedMin > mergedMax) {
      throw httpError(
        400,
        `min_fee (${mergedMin}) không được lớn hơn max_fee (${mergedMax}) sau khi kế thừa cấu hình mặc định`,
      );
    }

    const mergedTransferMin =
      normalized.transfer_min_fee !== undefined && normalized.transfer_min_fee !== null
        ? normalized.transfer_min_fee
        : base.transfer_min_fee;
    const isTransferUnbounded =
      normalized.transfer_max_fee_unbounded === true ||
      (normalized.transfer_max_fee === undefined && base.transfer_max_fee === null);
    const mergedTransferMax = isTransferUnbounded
      ? null
      : normalized.transfer_max_fee !== undefined
        ? normalized.transfer_max_fee
        : base.transfer_max_fee;

    if (mergedTransferMax !== null && mergedTransferMin > mergedTransferMax) {
      throw httpError(
        400,
        `transfer_min_fee (${mergedTransferMin}) không được lớn hơn transfer_max_fee (${mergedTransferMax}) sau khi kế thừa cấu hình mặc định`,
      );
    }
  }

  return normalized;
}

/**
 * Gộp cấu hình mặc định hệ thống với bản ghi override theo lịch của merchant.
 */
function mergeEffectiveFeeConfig(systemConfig, scheduleOverride = null, role = "MERCHANT") {
  const base = normalizeSystemFeeConfig(systemConfig, role);
  if (!scheduleOverride) {
    return {
      ...base,
      source: "SYSTEM_DEFAULT",
      schedule_id: null,
      effective_from: null,
    };
  }

  const rateBps =
    scheduleOverride.rate_bps !== null && scheduleOverride.rate_bps !== undefined
      ? Number(scheduleOverride.rate_bps)
      : base.rate_bps;
  const minFee =
    scheduleOverride.min_fee !== null && scheduleOverride.min_fee !== undefined
      ? Number(scheduleOverride.min_fee)
      : base.min_fee;
  const maxFee = scheduleOverride.max_fee_unbounded
    ? null
    : scheduleOverride.max_fee !== null && scheduleOverride.max_fee !== undefined
      ? Number(scheduleOverride.max_fee)
      : base.max_fee;
  const freeThresholdAmount =
    scheduleOverride.free_threshold_amount !== null &&
    scheduleOverride.free_threshold_amount !== undefined
      ? Number(scheduleOverride.free_threshold_amount)
      : base.free_threshold_amount;
  const transferFeeBps =
    scheduleOverride.transfer_fee_bps !== null &&
    scheduleOverride.transfer_fee_bps !== undefined
      ? Number(scheduleOverride.transfer_fee_bps)
      : base.transfer_fee_bps;
  const transferMinFee =
    scheduleOverride.transfer_min_fee !== null &&
    scheduleOverride.transfer_min_fee !== undefined
      ? Number(scheduleOverride.transfer_min_fee)
      : base.transfer_min_fee;
  const transferMaxFee = scheduleOverride.transfer_max_fee_unbounded
    ? null
    : scheduleOverride.transfer_max_fee !== null &&
        scheduleOverride.transfer_max_fee !== undefined
      ? Number(scheduleOverride.transfer_max_fee)
      : base.transfer_max_fee;
  const withdrawFeeBps =
    scheduleOverride.withdraw_fee_bps !== null &&
    scheduleOverride.withdraw_fee_bps !== undefined
      ? Number(scheduleOverride.withdraw_fee_bps)
      : base.withdraw_fee_bps;
  const withdrawFreeQuotaPerMonth =
    scheduleOverride.withdraw_free_quota_per_month !== null &&
    scheduleOverride.withdraw_free_quota_per_month !== undefined
      ? Number(scheduleOverride.withdraw_free_quota_per_month)
      : base.withdraw_free_quota_per_month;
  const monthlyPlanEnabled =
    scheduleOverride.monthly_plan_enabled !== null &&
    scheduleOverride.monthly_plan_enabled !== undefined
      ? Boolean(scheduleOverride.monthly_plan_enabled)
      : base.monthly_plan_enabled;
  const monthlyPlanFee =
    scheduleOverride.monthly_plan_fee !== null &&
    scheduleOverride.monthly_plan_fee !== undefined
      ? Number(scheduleOverride.monthly_plan_fee)
      : base.monthly_plan_fee;

  const hasExplicitTiersOverride =
    Array.isArray(scheduleOverride.tiers) && scheduleOverride.tiers.length > 0;
  const hasExplicitRateOverride =
    scheduleOverride.rate_bps !== null && scheduleOverride.rate_bps !== undefined;
  const tiers = hasExplicitTiersOverride
    ? coerceStoredTiers(scheduleOverride.tiers, base.tiers)
    : hasExplicitRateOverride
      ? []
      : base.tiers;

  return {
    rate_bps: rateBps,
    rate_percent: Number((rateBps / 100).toFixed(2)),
    min_fee: minFee,
    max_fee: maxFee,
    max_fee_unbounded: maxFee === null,
    free_threshold_amount: freeThresholdAmount,
    transfer_fee_bps: transferFeeBps,
    transfer_fee_percent: Number((transferFeeBps / 100).toFixed(2)),
    transfer_min_fee: transferMinFee,
    transfer_max_fee: transferMaxFee,
    transfer_max_fee_unbounded: transferMaxFee === null,
    withdraw_fee_bps: withdrawFeeBps,
    withdraw_fee_percent: Number((withdrawFeeBps / 100).toFixed(2)),
    withdraw_free_quota_per_month: withdrawFreeQuotaPerMonth,
    monthly_plan_enabled: monthlyPlanEnabled,
    monthly_plan_fee: monthlyPlanFee,
    monthly_grace_days: base.monthly_grace_days,
    tiers,
    PER_TRANSACTION: {
      percent_bps: rateBps,
      min_fee: minFee,
      max_fee: maxFee,
    },
    MONTHLY: {
      monthly_fee: monthlyPlanFee,
    },
    source: "MERCHANT_SCHEDULE",
    schedule_id: scheduleOverride.id || null,
    effective_from: scheduleOverride.effective_from
      ? new Date(scheduleOverride.effective_from).toISOString()
      : null,
  };
}

/**
 * Chọn biểu phí đang hiệu lực tại thời điểm `atDate` và biểu phí sắp tới (nếu có).
 */
function pickEffectiveSchedule(schedules = [], atDate = new Date()) {
  const targetMs = (atDate instanceof Date ? atDate : new Date(atDate)).getTime();
  let effective = null;
  let upcoming = null;

  for (const row of schedules) {
    if (!row || !row.effective_from) continue;
    const effMs = new Date(row.effective_from).getTime();
    const createdMs = row.created_at ? new Date(row.created_at).getTime() : 0;
    if (Number.isNaN(effMs)) continue;

    if (effMs <= targetMs) {
      if (
        !effective ||
        effMs > new Date(effective.effective_from).getTime() ||
        (effMs === new Date(effective.effective_from).getTime() &&
          createdMs > (effective.created_at ? new Date(effective.created_at).getTime() : 0))
      ) {
        effective = row;
      }
    } else {
      if (
        !upcoming ||
        effMs < new Date(upcoming.effective_from).getTime() ||
        (effMs === new Date(upcoming.effective_from).getTime() &&
          createdMs > (upcoming.created_at ? new Date(upcoming.created_at).getTime() : 0))
      ) {
        upcoming = row;
      }
    }
  }

  return { effectiveSchedule: effective, upcomingSchedule: upcoming };
}

/**
 * Nhân tỉ lệ theo basis points bằng BigInt thuần và làm tròn gần nhất (half-up = Math.round cho số dương).
 */
function roundBpsBigInt(baseInt, bpsInt) {
  const base = BigInt(baseInt);
  const bps = BigInt(bpsInt);
  return Number((base * bps + 5000n) / 10000n);
}

/**
 * Công thức chuẩn:
 * - Nếu gói tháng đang hiệu lực (ACTIVE hoặc trong grace period PAST_DUE): fee = 0
 * - Nếu amount < free_threshold_amount (khi free_threshold_amount > 0): fee = 0
 * - Ngược lại: fee = clamp(round(amount * rate_bps / 10000), min_fee, max_fee)
 */
function getEffectiveTierSchedule(cfg) {
  const rawTiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
  if (rawTiers.length === 0) {
    return [{ from_amount: 0, rate_bps: cfg.rate_bps }];
  }
  const normalized = rawTiers
    .map((t) => ({
      from_amount: Math.max(0, Math.trunc(Number(t?.from_amount ?? t?.from ?? 0) || 0)),
      rate_bps: Math.max(0, Math.min(10_000, Math.trunc(Number(t?.rate_bps ?? 0) || 0))),
    }))
    .sort((a, b) => a.from_amount - b.from_amount);

  if (normalized[0].from_amount > 0) {
    return [{ from_amount: 0, rate_bps: cfg.rate_bps }, ...normalized];
  }
  return normalized;
}

function calculateProgressiveRawFee(amount, alreadyMonthlyGross, cfg) {
  const validGrossBefore = parseStrictNonNegativeInt(
    alreadyMonthlyGross,
    "alreadyMonthlyGross",
  );
  const start = BigInt(validGrossBefore);
  const end = start + BigInt(amount);
  const schedule = getEffectiveTierSchedule(cfg);

  let totalWeightedBps = 0n;
  let singleRateBps = null;
  const breakdown = [];

  for (let i = 0; i < schedule.length; i += 1) {
    const tierStart = BigInt(schedule[i].from_amount);
    const tierEnd = i + 1 < schedule.length ? BigInt(schedule[i + 1].from_amount) : null;
    const segStart = start > tierStart ? start : tierStart;
    const segEnd = tierEnd !== null && end > tierEnd ? tierEnd : end;

    if (segEnd > segStart) {
      const sliceAmount = segEnd - segStart;
      const rateBps = schedule[i].rate_bps;
      totalWeightedBps += sliceAmount * BigInt(rateBps);
      singleRateBps = rateBps;
      breakdown.push({
        from_amount: Number(tierStart),
        to_amount: tierEnd !== null ? Number(tierEnd) : null,
        slice_amount: Number(sliceAmount),
        rate_percent: Number((rateBps / 100).toFixed(2)),
      });
    }
  }

  // Làm tròn một lần duy nhất ở cuối phép tính lũy tiến (HALF-UP)
  const rawFee = Number((totalWeightedBps + 5000n) / 10000n);
  const effectiveRateBps =
    breakdown.length === 1 && singleRateBps !== null
      ? singleRateBps
      : Number((totalWeightedBps + BigInt(Math.floor(amount / 2))) / BigInt(amount));

  return {
    rawFee,
    effectiveRateBps,
    effectiveRatePercent: Number((effectiveRateBps / 100).toFixed(2)),
    monthlyGrossBefore: validGrossBefore,
    monthlyGrossAfter: validGrossBefore + amount,
    breakdown,
  };
}

function calculatePerTransactionFeeDetails(
  amount,
  effectiveConfig,
  {
    monthlyPlanActive = false,
    monthlyStatus = MONTHLY_STATUS.INACTIVE,
    alreadyMonthlyGross = 0,
    role = "MERCHANT",
    feeType = FEE_TYPES.QR_FEE,
    feePlan = null,
  } = {},
) {
  const validAmount = assertPositiveIntegerAmount(amount);
  const cfg = normalizeSystemFeeConfig(effectiveConfig, role);
  const isTiered = Array.isArray(cfg.tiers) && cfg.tiers.length > 0;
  const validGrossBefore = parseStrictNonNegativeInt(
    alreadyMonthlyGross,
    "alreadyMonthlyGross",
  );

  const scheduleMeta = effectiveConfig?.schedule_id
    ? { schedule_id: effectiveConfig.schedule_id }
    : {};
  const isQrFee = feeType === FEE_TYPES.QR_FEE;
  const qrGrossMeta = isQrFee
    ? {
        monthly_qr_gross_before: validGrossBefore,
        monthly_qr_gross_after: validGrossBefore + validAmount,
      }
    : {};

  if (monthlyPlanActive) {
    const exemptReason =
      monthlyStatus === MONTHLY_STATUS.PAST_DUE
        ? "MONTHLY_PLAN_GRACE_PERIOD"
        : "MONTHLY_PLAN_ACTIVE";
    return {
      amount: validAmount,
      fee_amount: 0,
      net_amount: validAmount,
      exempt_reason: exemptReason,
      raw_fee: 0,
      clamped_to_min: false,
      clamped_to_max: false,
      clamped_to_amount: false,
      fee_rate_snapshot: {
        fee_type: feeType,
        monthly_status: monthlyStatus,
        exempt_reason: exemptReason,
        ...scheduleMeta,
      },
    };
  }

  if (cfg.free_threshold_amount > 0 && validAmount < cfg.free_threshold_amount) {
    return {
      amount: validAmount,
      fee_amount: 0,
      net_amount: validAmount,
      exempt_reason: "BELOW_FREE_THRESHOLD",
      raw_fee: 0,
      clamped_to_min: false,
      clamped_to_max: false,
      clamped_to_amount: false,
      fee_rate_snapshot: {
        fee_type: feeType,
        rate_percent: cfg.rate_percent,
        min_fee: cfg.min_fee,
        max_fee: cfg.max_fee,
        free_threshold_amount: cfg.free_threshold_amount,
        exempt_reason: "BELOW_FREE_THRESHOLD",
        ...scheduleMeta,
        ...qrGrossMeta,
      },
    };
  }

  const prog = calculateProgressiveRawFee(validAmount, validGrossBefore, cfg);
  let clampedFee = prog.rawFee;
  let clampedToMin = false;
  let clampedToMax = false;
  let clampedToAmount = false;

  if (clampedFee < cfg.min_fee) {
    clampedFee = cfg.min_fee;
    clampedToMin = true;
  }
  if (cfg.max_fee !== null && clampedFee > cfg.max_fee) {
    clampedFee = cfg.max_fee;
    clampedToMax = true;
  }
  if (clampedFee > validAmount) {
    clampedFee = validAmount;
    clampedToAmount = true;
  }

  return {
    amount: validAmount,
    fee_amount: clampedFee,
    net_amount: validAmount - clampedFee,
    exempt_reason: null,
    raw_fee: prog.rawFee,
    clamped_to_min: clampedToMin,
    clamped_to_max: clampedToMax,
    clamped_to_amount: clampedToAmount,
    fee_rate_snapshot: {
      fee_type: feeType,
      rate_percent: prog.effectiveRatePercent,
      min_fee: cfg.min_fee,
      max_fee: cfg.max_fee,
      ...(isTiered && prog.breakdown.length > 0
        ? { tier_breakdown: prog.breakdown }
        : {}),
      ...scheduleMeta,
      ...qrGrossMeta,
    },
  };
}

/**
 * Tính phí chuyển P2P chiều đi của ví MERCHANT theo transfer_fee_bps / transfer_min_fee / transfer_max_fee.
 */
function calculateMerchantTransferFeeDetails(amount, effectiveConfig) {
  const cfg = normalizeSystemFeeConfig(effectiveConfig, "MERCHANT");
  const transferConfig = {
    source: effectiveConfig?.source || "SYSTEM_DEFAULT",
    schedule_id: effectiveConfig?.schedule_id || null,
    effective_from: effectiveConfig?.effective_from || null,
    rate_bps: cfg.transfer_fee_bps,
    min_fee: cfg.transfer_min_fee,
    max_fee: cfg.transfer_max_fee,
    max_fee_unbounded: cfg.transfer_max_fee === null,
    free_threshold_amount: 0,
    tiers: [],
  };
  return calculatePerTransactionFeeDetails(amount, transferConfig, {
    monthlyPlanActive: false,
    alreadyMonthlyGross: 0,
    role: "MERCHANT",
    feeType: FEE_TYPES.USER_FEE,
    feePlan: "MERCHANT_TRANSFER",
  });
}

/**
 * Tính phí rút tiền chỉ trên phần vượt hạn mức miễn phí tháng hiện tại.
 */
function calculateWithdrawFeeDetails(
  amount,
  effectiveConfig,
  { alreadyWithdrawn = 0, role = "MERCHANT" } = {},
) {
  const validAmount = assertPositiveIntegerAmount(amount);
  const validAlreadyWithdrawn = parseStrictNonNegativeInt(
    alreadyWithdrawn,
    "alreadyWithdrawn",
  );
  const cfg = normalizeSystemFeeConfig(effectiveConfig, role);

  const quota = cfg.withdraw_free_quota_per_month;
  const remainingBefore = Math.max(0, quota - validAlreadyWithdrawn);
  const freeCoveredAmount = Math.min(validAmount, remainingBefore);
  const taxableExcessAmount = validAmount - freeCoveredAmount;
  const remainingAfter = Math.max(0, remainingBefore - validAmount);

  const feeAmount =
    taxableExcessAmount > 0 && cfg.withdraw_fee_bps > 0
      ? roundBpsBigInt(taxableExcessAmount, cfg.withdraw_fee_bps)
      : 0;
  const totalDebit = validAmount + feeAmount;

  return {
    amount: validAmount,
    fee_amount: feeAmount,
    net_amount: validAmount,
    total_debit_from_payer: totalDebit,
    withdraw_quota: {
      quota_per_month: quota,
      already_withdrawn: validAlreadyWithdrawn,
      remaining_before: remainingBefore,
      remaining_after: remainingAfter,
      free_covered_amount: freeCoveredAmount,
      taxable_excess_amount: taxableExcessAmount,
    },
    fee_rate_snapshot: {
      fee_type: "WITHDRAW_FEE",
      withdraw_fee_percent: cfg.withdraw_fee_percent,
      taxable_excess_amount: taxableExcessAmount,
      ...(quota > 0
        ? {
            withdraw_free_quota_per_month: quota,
            already_withdrawn_before: validAlreadyWithdrawn,
          }
        : {}),
      ...(effectiveConfig?.schedule_id
        ? { schedule_id: effectiveConfig.schedule_id }
        : {}),
    },
  };
}

/**
 * Hàm tính preview thống nhất cho App Flutter, Web Merchant và Admin --dry-run / preview.
 */
function previewFeeCalculation({
  transactionType,
  role = "USER",
  amount,
  effectiveConfig,
  alreadyWithdrawn = 0,
  alreadyMonthlyGross = 0,
  destinationRole = null,
  recipientEffectiveConfig = null,
  recipientMonthlyGross = 0,
  monthlyPlanActive = false,
  monthlyStatus = MONTHLY_STATUS.INACTIVE,
}) {
  const txType = String(transactionType || "").trim().toUpperCase();
  const normalizedRole = String(role || "USER").trim().toUpperCase();
  const validAmount = assertPositiveIntegerAmount(amount);

  if (txType === "PAYMENT" || txType === "QR_PAYMENT") {
    const details = calculatePerTransactionFeeDetails(validAmount, effectiveConfig, {
      monthlyPlanActive,
      monthlyStatus,
      alreadyMonthlyGross,
      role: "MERCHANT",
    });
    return {
      transaction_type: "PAYMENT",
      amount: validAmount,
      fee_amount: details.fee_amount,
      fee_payer: details.fee_amount > 0 ? "MERCHANT" : "NONE",
      net_amount: details.net_amount,
      total_debit_from_payer: validAmount,
      total_receive_by_merchant: details.net_amount,
      exempt_reason: details.exempt_reason,
      fee_rate_snapshot: details.fee_rate_snapshot,
      withdraw_quota: null,
    };
  }

  if (txType === "WITHDRAW") {
    const details = calculateWithdrawFeeDetails(validAmount, effectiveConfig, {
      alreadyWithdrawn,
      role: normalizedRole,
    });
    return {
      transaction_type: "WITHDRAW",
      amount: validAmount,
      fee_amount: details.fee_amount,
      fee_payer: details.fee_amount > 0 ? "SENDER" : "NONE",
      net_amount: details.net_amount,
      total_debit_from_payer: details.total_debit_from_payer,
      total_receive_by_merchant: null,
      exempt_reason:
        details.fee_amount === 0
          ? details.withdraw_quota.free_covered_amount > 0 &&
            details.withdraw_quota.taxable_excess_amount === 0
            ? "WITHIN_FREE_WITHDRAW_QUOTA"
            : "ZERO_WITHDRAW_FEE"
          : null,
      fee_rate_snapshot: details.fee_rate_snapshot,
      withdraw_quota: details.withdraw_quota,
    };
  }

  if (txType === "TRANSFER" || txType === "P2P") {
    const senderDetails =
      normalizedRole === "MERCHANT"
        ? calculateMerchantTransferFeeDetails(validAmount, effectiveConfig)
        : calculatePerTransactionFeeDetails(validAmount, effectiveConfig, {
            monthlyPlanActive: false,
            role: "USER",
            feeType: FEE_TYPES.USER_FEE,
            feePlan: "USER_TRANSFER",
          });

    const destIsMerchant =
      String(destinationRole || "").trim().toUpperCase() === "MERCHANT" &&
      recipientEffectiveConfig;

    let inboundMerchantDetails = null;
    if (destIsMerchant) {
      inboundMerchantDetails = calculatePerTransactionFeeDetails(
        validAmount,
        recipientEffectiveConfig,
        {
          monthlyPlanActive: false,
          alreadyMonthlyGross: recipientMonthlyGross,
          role: "MERCHANT",
          feeType: FEE_TYPES.QR_FEE,
        },
      );
    }

    const senderFee = senderDetails.fee_amount;
    const inboundFee = inboundMerchantDetails ? inboundMerchantDetails.fee_amount : 0;
    const netAmount = validAmount - inboundFee;

    const feePayer =
      senderFee > 0 && inboundFee > 0
        ? "BOTH"
        : senderFee > 0
          ? "SENDER"
          : inboundFee > 0
            ? "MERCHANT"
            : "NONE";

    const snapshot = inboundMerchantDetails
      ? {
          ...inboundMerchantDetails.fee_rate_snapshot,
          inbound_transfer_qr_fee: true,
          ...(senderFee > 0
            ? {
                sender_fee_amount: senderFee,
                sender_fee_snapshot: senderDetails.fee_rate_snapshot,
              }
            : {}),
        }
      : senderDetails.fee_rate_snapshot;

    return {
      transaction_type: "TRANSFER",
      amount: validAmount,
      fee_amount: senderFee,
      merchant_fee_amount: inboundFee,
      fee_payer: feePayer,
      net_amount: netAmount,
      total_debit_from_payer: validAmount + senderFee,
      total_receive_by_merchant: destIsMerchant ? netAmount : null,
      exempt_reason:
        senderFee === 0 && inboundFee === 0
          ? senderDetails.exempt_reason || "ZERO_FEE_CONFIG"
          : null,
      fee_rate_snapshot: snapshot,
      withdraw_quota: null,
    };
  }

  if (txType === "TOPUP") {
    return {
      transaction_type: "TOPUP",
      amount: validAmount,
      fee_amount: 0,
      fee_payer: "NONE",
      net_amount: validAmount,
      total_debit_from_payer: validAmount,
      total_receive_by_merchant: null,
      exempt_reason: "TOPUP_FREE",
      fee_rate_snapshot: null,
      withdraw_quota: null,
    };
  }

  throw httpError(
    400,
    "transaction_type phải là PAYMENT, QR_PAYMENT, WITHDRAW, TRANSFER hoặc TOPUP",
  );
}

function getVnMonthMeta(nowMs = Date.now()) {
  const vnNow = new Date(nowMs + VN_OFFSET_MS);
  const year = vnNow.getUTCFullYear();
  const month0 = vnNow.getUTCMonth();
  const monthNum = month0 + 1;

  const nextStartUtcMs = Date.UTC(year, month0 + 1, 1) - VN_OFFSET_MS;
  const nextMonthVn = new Date(nextStartUtcMs + VN_OFFSET_MS);
  const nextYear = nextMonthVn.getUTCFullYear();
  const nextMonthNum = nextMonthVn.getUTCMonth() + 1;

  const endDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const pad2 = (n) => String(n).padStart(2, "0");

  return {
    currentMonth: `${pad2(monthNum)}/${year}`,
    currentMonthKey: `${year}-${pad2(monthNum)}`,
    currentMonthEndDate: `${pad2(endDay)}/${pad2(monthNum)}/${year}`,
    nextMonth: `${pad2(nextMonthNum)}/${nextYear}`,
    nextMonthKey: `${nextYear}-${pad2(nextMonthNum)}`,
    nextMonthStart: new Date(nextStartUtcMs),
    nextMonthStartDate: `01/${pad2(nextMonthNum)}/${nextYear}`,
  };
}

module.exports = {
  SYSTEM_FEE_WALLET_ID,
  SYSTEM_FEE_WALLET_PHONE,
  VN_OFFSET_MS,
  FEE_TYPES,
  MONTHLY_STATUS,
  DEFAULT_MERCHANT_FEE_TIERS,
  DEFAULT_MERCHANT_FEE_CONFIG,
  DEFAULT_USER_FEE_CONFIG,
  assertPositiveIntegerAmount,
  parseStrictNonNegativeInt,
  percentToBpsStrict,
  normalizeRateBps,
  normalizeTiersInput,
  normalizeSystemFeeConfig,
  validateFeeConfigInput,
  mergeEffectiveFeeConfig,
  pickEffectiveSchedule,
  roundBpsBigInt,
  getEffectiveTierSchedule,
  calculateProgressiveRawFee,
  calculatePerTransactionFeeDetails,
  calculateMerchantTransferFeeDetails,
  calculateWithdrawFeeDetails,
  previewFeeCalculation,
  getVnMonthMeta,
};
