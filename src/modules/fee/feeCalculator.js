const { httpError } = require("../../utils/httpError");
require("dotenv").config();

// Biểu thức chính quy kiểm tra định dạng UUID (v4 / v7) hợp lệ
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mã định danh (UUID) của ví thu phí hệ thống đọc từ biến môi trường
const SYSTEM_FEE_WALLET_ID =
  String(process.env.SYSTEM_FEE_WALLET_ID || "").trim() || undefined;

// Số điện thoại của ví thu phí hệ thống đọc từ biến môi trường (ví dụ: SYS_FEE_01)
const SYSTEM_FEE_WALLET_PHONE =
  String(process.env.SYSTEM_FEE_WALLET_PHONE || "").trim() || undefined;

// Khoảng chênh lệch thời gian múi giờ Việt Nam (UTC+7) tính bằng mili-giây
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Kiểm tra cấu hình ví thu phí hệ thống từ biến môi trường lúc khởi động hoặc khi xử lý phí.
 * Ném lỗi nếu thiếu hoặc sai định dạng UUID.
 * @returns {{ walletId: string, walletPhone: string }}
 */
function assertSystemFeeWalletConfigured() {
  const walletId = String(
    ("SYSTEM_FEE_WALLET_ID" in process.env
      ? process.env.SYSTEM_FEE_WALLET_ID
      : SYSTEM_FEE_WALLET_ID) || "",
  ).trim();
  const walletPhone = String(
    ("SYSTEM_FEE_WALLET_PHONE" in process.env
      ? process.env.SYSTEM_FEE_WALLET_PHONE
      : SYSTEM_FEE_WALLET_PHONE) || "",
  ).trim();

  if (!walletId || !UUID_RE.test(walletId)) {
    throw new Error(
      "Thiếu hoặc sai định dạng SYSTEM_FEE_WALLET_ID (mã ví hệ thống) trong biến môi trường",
    );
  }
  if (!walletPhone) {
    throw new Error(
      "Thiếu SYSTEM_FEE_WALLET_PHONE (số điện thoại ví hệ thống) trong biến môi trường",
    );
  }
  return { walletId, walletPhone };
}

// Danh mục định danh các loại phí giao dịch trong toàn bộ hệ thống
const FEE_TYPES = Object.freeze({
  QR_FEE: "QR_FEE",                     // Phí nhận tiền qua mã QR của merchant
  USER_FEE: "USER_FEE",                 // Phí dịch vụ hoặc phí chuyển tiền người gửi trả
  WITHDRAW_FEE: "WITHDRAW_FEE",         // Phí rút tiền về ngân hàng
  MONTHLY_PLAN_FEE: "MONTHLY_PLAN_FEE", // Phí duy trì gói cước theo tháng
});

// Danh mục các trạng thái gói thu phí theo tháng của merchant
const MONTHLY_STATUS = Object.freeze({
  INACTIVE: "INACTIVE",                 // Không kích hoạt gói tháng (áp dụng phí từng giao dịch)
  ACTIVE: "ACTIVE",                     // Đang kích hoạt gói tháng
  PENDING_ACTIVATE: "PENDING_ACTIVATE", // Chờ kích hoạt
  PAST_DUE: "PAST_DUE",                 // Quá hạn thanh toán gói tháng (trong thời gian ân hạn)
});

// Bảng bậc thang tỷ lệ phí QR lũy tiến mặc định của Merchant theo doanh số tháng (dự phòng)
// 0 -> 50tr: 1.00% (100 bps); 50tr -> 200tr: 0.80% (80 bps); trên 200tr: 0.60% (60 bps)
const DEFAULT_MERCHANT_FEE_TIERS = Object.freeze([
  Object.freeze({ from_amount: 0, rate_bps: 100 }),
  Object.freeze({ from_amount: 50_000_000, rate_bps: 80 }),
  Object.freeze({ from_amount: 200_000_000, rate_bps: 60 }),
]);

// Cấu hình biểu phí mặc định cho Merchant (dự phòng khi cơ sở dữ liệu chưa có cấu hình)
const DEFAULT_MERCHANT_FEE_CONFIG = Object.freeze({
  rate_bps: 100,                               // Tỷ lệ phí cơ bản mặc định: 1.00% (100 bps)
  min_fee: 200,                                // Mức phí tối thiểu mỗi giao dịch: 200 VND
  max_fee: null,                               // Mức phí tối đa mỗi giao dịch: không giới hạn
  max_fee_unbounded: true,                     // Cờ đánh dấu không giới hạn trần phí
  free_threshold_amount: 0,                    // Ngưỡng miễn phí đơn hàng nhỏ: 0 (không áp dụng)
  transfer_fee_bps: 0,                         // Phí chuyển P2P chiều đi của merchant: 0%
  transfer_min_fee: 0,                         // Mức phí chuyển P2P tối thiểu: 0 VND
  transfer_max_fee: null,                      // Mức phí chuyển P2P tối đa: không giới hạn
  transfer_max_fee_unbounded: true,            // Cờ không giới hạn trần phí chuyển P2P
  withdraw_fee_bps: 50,                        // Tỷ lệ phí rút tiền về ngân hàng: 0.50% (50 bps)
  withdraw_free_quota_per_month: 50_000_000,   // Hạn mức rút tiền miễn phí mỗi tháng: 50 triệu VND
  monthly_plan_enabled: false,                 // Gói thuê bao tháng: tắt mặc định
  monthly_plan_fee: 0,                         // Cước thuê bao tháng: 0 VND
  monthly_grace_days: 7,                       // Số ngày ân hạn khi quá cước tháng: 7 ngày
  tiers: DEFAULT_MERCHANT_FEE_TIERS,           // Bảng phân bậc doanh số mặc định
});

// Cấu hình biểu phí mặc định cho User cá nhân (miễn phí tất cả các luồng)
const DEFAULT_USER_FEE_CONFIG = Object.freeze({
  rate_bps: 0,                                 // Tỷ lệ phí giao dịch: 0%
  min_fee: 0,                                  // Mức phí tối thiểu: 0 VND
  max_fee: null,                               // Mức phí tối đa: không giới hạn
  max_fee_unbounded: true,                     // Cờ không giới hạn trần phí
  free_threshold_amount: 0,                    // Ngưỡng miễn phí: 0 VND
  transfer_fee_bps: 0,                         // Tỷ lệ phí chuyển tiền P2P: 0%
  transfer_min_fee: 0,                         // Mức phí chuyển P2P tối thiểu: 0 VND
  transfer_max_fee: null,                      // Mức phí chuyển P2P tối đa: không giới hạn
  transfer_max_fee_unbounded: true,            // Cờ không giới hạn trần phí chuyển P2P
  withdraw_fee_bps: 0,                         // Tỷ lệ phí rút tiền về ngân hàng: 0% (miễn phí)
  withdraw_free_quota_per_month: 0,            // Hạn mức rút miễn phí: 0 (mặc định đã miễn phí hoàn toàn)
  monthly_plan_enabled: false,                 // Không áp dụng gói tháng
  monthly_plan_fee: 0,                         // Cước tháng: 0 VND
  monthly_grace_days: 7,                       // Số ngày ân hạn: 7 ngày
  tiers: [],                                   // Không phân bậc doanh số
});

/**
 * Kiểm tra và ép kiểu giá trị đầu vào thành số nguyên không âm (>= 0).
 * Ném lỗi 400 nếu dữ liệu không phải số hợp lệ hoặc nhỏ hơn 0.
 * @param {any} raw - Dữ liệu thô cần kiểm tra
 * @param {string} fieldName - Tên trường dùng để báo lỗi
 * @returns {number}
 */
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

/**
 * Kiểm tra số tiền giao dịch phải là số nguyên dương lớn hơn 0 (> 0).
 * @param {any} raw - Dữ liệu thô cần kiểm tra
 * @param {string} fieldName - Tên trường dùng để báo lỗi
 * @returns {number}
 */
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

/**
 * Quy đổi tỷ lệ phần trăm (0..100%) sang đơn vị basis points (bps, 1% = 100 bps).
 * Kiểm tra nghiêm ngặt: chỉ hỗ trợ tối đa 2 chữ số thập phân (bội số 0.01%).
 * Ví dụ: 1 -> 100; 0.85 -> 85; 0.05 -> 5.
 * @param {number|string} rawPercent - Tỷ lệ phần trăm
 * @param {string} fieldName - Tên trường báo lỗi
 * @returns {number} Giá trị bps nguyên (0..10000)
 */
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

/**
 * Chuẩn hóa tỷ lệ phí giữa 2 cách biểu diễn: điểm cơ bản (bps) và phần trăm (%).
 * Nếu truyền cả hai thì bắt buộc phải khớp nhau về mặt giá trị toán học.
 * @param {number|string} bpsRaw - Giá trị bps (0..10000)
 * @param {number|string} percentRaw - Giá trị phần trăm (0..100)
 * @param {string} fieldName - Tên trường báo lỗi
 * @returns {number|undefined} Giá trị bps đã chuẩn hóa
 */
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

/**
 * Chuẩn hóa và kiểm tra danh sách các bậc thang doanh số đầu vào khi cập nhật biểu phí.
 * Sắp xếp các bậc theo mốc `from_amount` tăng dần và chặn trùng lặp mốc.
 * @param {Array<object>} rawTiers - Mảng các bậc doanh số thô
 * @returns {Array<{ from_amount: number, rate_bps: number, rate_percent: number }>}
 */
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

/**
 * Ép kiểu an toàn dữ liệu bậc thang đọc từ JSON cơ sở dữ liệu sang mảng định dạng chuẩn.
 * Nếu dữ liệu không hợp lệ thì fallback về danh sách mặc định.
 * @param {Array<object>} rawTiers - Dữ liệu bậc thang lưu trong DB
 * @param {Array<object>} fallbackTiers - Danh sách dự phòng
 * @returns {Array<{ from_amount: number, rate_bps: number, rate_percent: number }>}
 */
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
 * Chuẩn hóa đối tượng JSON cấu hình biểu phí thô đọc từ bảng `system_configs`.
 * - Hỗ trợ cả định dạng phẳng mới và định dạng cũ (lồng trong `PER_TRANSACTION` / `MONTHLY`).
 * - Áp dụng các giá trị dự phòng (fallback) theo `role` (MERCHANT hoặc USER) nếu dữ liệu thiếu trường.
 * - Đảm bảo các trường số luôn nguyên, không âm, tỷ lệ bps nằm trong khoảng 0..10000 (0..100%).
 * 
 * @param {object} raw - Dữ liệu JSON thô từ DB hoặc API
 * @param {string} [role="MERCHANT"] - Vai trò đối tượng áp dụng ('MERCHANT' hoặc 'USER')
 * @returns {object} Cấu hình chuẩn hóa với đầy đủ các trường
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
 * Xác thực và chuẩn hóa toàn bộ dữ liệu khi Admin API / CLI cập nhật cấu hình biểu phí.
 * - Kiểm tra tính hợp lệ của từng trường (rate_bps, min_fee, max_fee, tiers, withdraw, transfer).
 * - Kiểm tra bất biến: min_fee <= max_fee và transfer_min_fee <= transfer_max_fee.
 * - Kiểm tra effective_from không được đặt ở quá khứ nếu là cấu hình override.
 * 
 * @param {object} input - Dữ liệu cập nhật từ client
 * @param {object} [options]
 * @param {boolean} [options.isOverride=false] - Cờ đánh dấu có phải là override theo lịch hay không
 * @param {Date} [options.now=new Date()] - Thời điểm hiện tại dùng để so sánh mốc effective_from
 * @param {object} [options.baseConfig=null] - Cấu hình nền dùng để kiểm tra tính hợp lệ sau khi kế thừa
 * @returns {object} Đối tượng cấu hình đã chuẩn hóa và xác thực
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
 * Gộp cấu hình mặc định hệ thống với bản ghi cấu hình theo lịch (schedule override) của merchant.
 * - Các trường trong scheduleOverride nếu khác null/undefined sẽ ghi đè giá trị tương ứng của hệ thống.
 * - Các trường còn lại sẽ kế thừa từ biểu phí mặc định của hệ thống.
 * 
 * @param {object} systemConfig - Cấu hình mặc định hệ thống (MERCHANT_FEE_CONFIG)
 * @param {object|null} [scheduleOverride=null] - Bản ghi cấu hình biểu phí theo lịch của merchant
 * @param {string} [role="MERCHANT"] - Vai trò đối tượng áp dụng
 * @returns {object} Cấu hình hiệu lực hoàn chỉnh sau khi gộp
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
 * Chọn biểu phí đang hiệu lực tại thời điểm `atDate` và biểu phí kế tiếp trong tương lai (nếu có).
 * - Biểu phí hiệu lực: có `effective_from <= atDate` và có mốc áp dụng gần thời điểm xét nhất.
 * - Biểu phí sắp tới: có `effective_from > atDate` và có mốc áp dụng sớm nhất trong tương lai.
 * 
 * @param {Array<object>} schedules - Danh sách các bản ghi lịch biểu phí
 * @param {Date} [atDate=new Date()] - Thời điểm cần tra cứu hiệu lực
 * @returns {{ effectiveSchedule: object|null, upcomingSchedule: object|null }}
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
 * Nhân số tiền gốc với tỷ lệ điểm cơ bản (bps) bằng BigInt thuần và làm tròn nửa lên (HALF-UP = Math.round cho số dương).
 * Công thức: Math.floor((base * bps + 5000) / 10000).
 * Tránh hoàn toàn sai số dấu phẩy động của JavaScript khi xử lý tiền tệ lớn.
 * 
 * @param {number|bigint} baseInt - Số tiền gốc (VND)
 * @param {number|bigint} bpsInt - Tỷ lệ tính theo basis points (1% = 100 bps)
 * @returns {number} Số tiền phí sau khi làm tròn
 */
function roundBpsBigInt(baseInt, bpsInt) {
  const base = BigInt(baseInt);
  const bps = BigInt(bpsInt);
  return Number((base * bps + 5000n) / 10000n);
}

/**
 * Lấy bảng bậc thang tính phí có hiệu lực từ đối tượng cấu hình.
 * - Chuẩn hóa và sắp xếp các mốc `from_amount` tăng dần.
 * - Luôn đảm bảo mốc bắt đầu đầu tiên `from_amount = 0` được gán tỷ lệ mặc định nếu mảng không bắt đầu từ 0.
 * 
 * @param {object} cfg - Đối tượng cấu hình biểu phí
 * @returns {Array<{ from_amount: number, rate_bps: number }>}
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

/**
 * Hàm tính phí lũy tiến bậc thang theo doanh số nhận QR trong tháng (chưa áp sàn/trần).
 * 
 * Nguyên tắc:
 * - Doanh số tích lũy tính trên số tiền gốc của giao dịch (chưa trừ phí).
 * - Nếu giao dịch vượt qua mốc bậc thang (ví dụ từ 49tr lên 52tr), giao dịch sẽ được tách đôi:
 *   + Khúc 1tr lấp đầy 50tr chịu 1%.
 *   + Khúc 2tr vượt 50tr chịu 0.8%.
 * - Làm tròn tiền phí một lần duy nhất ở cuối theo công thức HALF-UP: (tổng_bps + 5000) / 10000.
 *
 * @param {number} amount - Số tiền của giao dịch hiện tại (VND nguyên dương).
 * @param {number} alreadyMonthlyGross - Doanh số nhận QR tích lũy trong tháng tính đến trước giao dịch này.
 * @param {object} cfg - Cấu hình phí của đối tượng (chứa bảng tiers hoặc rate_bps cơ bản).
 * @returns {object} { rawFee, effectiveRateBps, effectiveRatePercent, monthlyGrossBefore, monthlyGrossAfter, breakdown }
 */
function calculateProgressiveRawFee(amount, alreadyMonthlyGross, cfg) {
  // 1. Kiểm tra và chuẩn hóa doanh số tháng trước giao dịch thành số nguyên không âm
  const validGrossBefore = parseStrictNonNegativeInt(
    alreadyMonthlyGross,
    "alreadyMonthlyGross",
  );

  // 2. Chuyển sang BigInt để tránh tràn số và sai số số thực khi tính toán với số tiền lớn
  const start = BigInt(validGrossBefore);      // Điểm bắt đầu của giao dịch trên trục doanh số tháng
  const end = start + BigInt(amount);          // Điểm kết thúc của giao dịch sau khi cộng thêm số tiền này

  // 3. Lấy bảng phân bậc có hiệu lực (ví dụ: [0->50tr: 100 bps], [50tr->200tr: 80 bps], [200tr+: 60 bps])
  const schedule = getEffectiveTierSchedule(cfg);

  let totalWeightedBps = 0n; // Tổng tích lũy của (slice_amount * rate_bps) dùng để tính phí làm tròn một lần ở cuối
  let singleRateBps = null;  // Lưu rate_bps nếu giao dịch nằm trọn vẹn trong duy nhất 1 bậc
  const breakdown = [];      // Danh sách chi tiết các khúc tiền rơi vào từng bậc thang

  // 4. Lặp qua từng bậc để cắt lát (slice) số tiền giao dịch
  for (let i = 0; i < schedule.length; i += 1) {
    const tierStart = BigInt(schedule[i].from_amount); // Ngưỡng dưới của bậc hiện tại
    const tierEnd = i + 1 < schedule.length ? BigInt(schedule[i + 1].from_amount) : null; // Ngưỡng trên (null nếu là bậc vô hạn cuối cùng)

    // Xác định phần giao giữa đoạn giao dịch [start, end] và khoảng của bậc [tierStart, tierEnd]
    const segStart = start > tierStart ? start : tierStart; // Điểm bắt đầu của khúc tiền trong bậc này
    const segEnd = tierEnd !== null && end > tierEnd ? tierEnd : end; // Điểm kết thúc của khúc tiền trong bậc này

    // Nếu có tiền rơi vào bậc này (đoạn giao hợp lệ)
    if (segEnd > segStart) {
      const sliceAmount = segEnd - segStart;   // Độ dài khúc tiền rơi vào bậc này
      const rateBps = schedule[i].rate_bps;    // Tỷ lệ phí của bậc này tính theo bps (100 bps = 1%)

      totalWeightedBps += sliceAmount * BigInt(rateBps); // Cộng dồn tích lũy để tính phí
      singleRateBps = rateBps;                 // Ghi nhận rate_bps nếu chỉ có 1 bậc

      // Ghi lại chi tiết khúc tiền này vào breakdown
      breakdown.push({
        from_amount: Number(tierStart),                       // Mốc dưới của bậc
        to_amount: tierEnd !== null ? Number(tierEnd) : null, // Mốc trên của bậc (null nếu là bậc cuối)
        slice_amount: Number(sliceAmount),                    // Số tiền của giao dịch rơi vào bậc này
        rate_percent: Number((rateBps / 100).toFixed(2)),     // % phí của riêng bậc này
      });
    }
  }

  // 5. Tính phí thô bằng cách chia 10.000 với quy tắc làm tròn HALF-UP (cộng 5.000 trước khi chia nguyên)
  // Ví dụ: 10.049 * 100 + 5000 = 1.009.900 / 10000 = 100đ; 10.050 * 100 + 5000 = 1.010.000 / 10000 = 101đ
  const rawFee = Number((totalWeightedBps + 5000n) / 10000n);

  // 6. Tính tỷ lệ % hiệu dụng (effectiveRateBps) của cả đơn:
  // - Nếu đơn chỉ rơi vào đúng 1 bậc: lấy chính xác tỷ lệ của bậc đó (ví dụ 100 bps = 1%).
  // - Nếu đơn bắc cầu qua 2 bậc: lấy trung bình gia quyền (tổng_tích_lũy / tổng_tiền) và làm tròn HALF-UP.
  //   LƯU Ý: Con số này chỉ dùng để ghi nhận/hiển thị tỷ lệ tương đối của đơn, không dùng để nhân ra tiền phí.
  const effectiveRateBps =
    breakdown.length === 1 && singleRateBps !== null
      ? singleRateBps
      : Number((totalWeightedBps + BigInt(Math.floor(amount / 2))) / BigInt(amount));

  return {
    rawFee,                                            // Phí thô tính theo tỷ lệ bậc thang (chưa áp min/max fee)
    effectiveRateBps,                                  // Tỷ lệ hiệu dụng theo bps
    effectiveRatePercent: Number((effectiveRateBps / 100).toFixed(2)), // Tỷ lệ hiệu dụng quy đổi ra % (ví dụ 0.87%)
    monthlyGrossBefore: validGrossBefore,              // Doanh số tháng trước giao dịch
    monthlyGrossAfter: validGrossBefore + amount,      // Doanh số tháng sau giao dịch
    breakdown,                                         // Danh sách chi tiết các bậc đã cắt lát
  };
}

/**
 * Hàm tính chi tiết phí cho một giao dịch đơn lẻ (áp dụng cho QR payment hoặc P2P).
 * Xử lý tuần tự:
 * 1. Kiểm tra miễn phí gói tháng (nếu có).
 * 2. Kiểm tra miễn phí theo ngưỡng đơn hàng nhỏ (free_threshold_amount).
 * 3. Tính phí thô theo bậc thang lũy tiến (calculateProgressiveRawFee).
 * 4. Chặn ngưỡng sàn (min_fee) và trần (max_fee nếu có).
 * 5. Đảm bảo bất biến: Phí không bao giờ vượt quá số tiền giao dịch (clampedFee <= validAmount), thực nhận không âm.
 * 6. Đóng gói snapshot biểu phí để lưu DB và trả về kết quả.
 */
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
  // 1. Kiểm tra và chuẩn hóa số tiền giao dịch thành số nguyên dương
  const validAmount = assertPositiveIntegerAmount(amount);

  // 2. Chuẩn hóa cấu hình biểu phí tương ứng với role (MERCHANT hoặc USER)
  const cfg = normalizeSystemFeeConfig(effectiveConfig, role);

  // 3. Kiểm tra xem cấu hình có phân bậc thang hay không
  const isTiered = Array.isArray(cfg.tiers) && cfg.tiers.length > 0;

  // 4. Chuẩn hóa doanh số tháng trước giao dịch
  const validGrossBefore = parseStrictNonNegativeInt(
    alreadyMonthlyGross,
    "alreadyMonthlyGross",
  );

  // 5. Chuẩn bị metadata cho snapshot: schedule_id (nếu là biểu phí riêng của admin) và thông tin doanh số tháng
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

  // TRƯỜNG HỢP A: Miễn phí vì đang áp dụng gói tháng hoặc đang trong ân hạn
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

  // TRƯỜNG HỢP B: Miễn phí nếu số tiền giao dịch nhỏ hơn ngưỡng miễn phí (nếu được cấu hình > 0)
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

  // TRƯỜNG HỢP C: Tính phí bậc thang thông thường
  // 1. Tính phí thô theo các bậc thang doanh số
  const prog = calculateProgressiveRawFee(validAmount, validGrossBefore, cfg);
  let clampedFee = prog.rawFee;
  let clampedToMin = false;
  let clampedToMax = false;
  let clampedToAmount = false;

  // 2. Chặn sàn: Nếu phí tính ra nhỏ hơn min_fee, nâng lên bằng min_fee (ví dụ phí tối thiểu 200đ)
  if (clampedFee < cfg.min_fee) {
    clampedFee = cfg.min_fee;
    clampedToMin = true;
  }

  // 3. Chặn trần: Nếu có cấu hình max_fee và phí vượt trần, hạ xuống bằng max_fee
  if (cfg.max_fee !== null && clampedFee > cfg.max_fee) {
    clampedFee = cfg.max_fee;
    clampedToMax = true;
  }

  // 4. Bất biến tiền tệ: Phí không bao giờ được lớn hơn số tiền giao dịch (đơn 150đ < min_fee 200đ thì phí = 150đ, net = 0đ)
  if (clampedFee > validAmount) {
    clampedFee = validAmount;
    clampedToAmount = true;
  }

  return {
    amount: validAmount,                         // Số tiền gốc của giao dịch
    fee_amount: clampedFee,                      // Số tiền phí thực tế phải thu sau khi đã áp sàn/trần
    net_amount: validAmount - clampedFee,        // Số tiền thực nhận sau khi trừ phí (luôn >= 0)
    exempt_reason: null,                         // Không được miễn phí
    raw_fee: prog.rawFee,                        // Phí thô ban đầu trước khi kẹp sàn/trần
    clamped_to_min: clampedToMin,                // Cờ báo: có bị ép lên mức phí tối thiểu không
    clamped_to_max: clampedToMax,                // Cờ báo: có bị cắt xuống mức phí tối đa không
    clamped_to_amount: clampedToAmount,          // Cờ báo: có bị giới hạn bằng số tiền giao dịch không
    /**
     * fee_rate_snapshot: Ảnh chụp biểu phí tại đúng thời điểm giao dịch thành công.
     * Dùng để lưu vết đối soát và hiển thị trên Web/App:
     * - fee_type: Loại phí ('QR_FEE', 'WITHDRAW_FEE', 'USER_FEE', 'MONTHLY_PLAN_FEE').
     * - rate_percent: % phí hiệu dụng (nếu bắc cầu nhiều bậc thì là % bình quân gia quyền của cả đơn, ví dụ 0.87%).
     * - min_fee, max_fee: Ngưỡng sàn/trần phí áp dụng.
     * - tier_breakdown: Chi tiết từng khúc tiền rơi vào bậc nào (from_amount, to_amount, slice_amount, rate_percent).
     * - monthly_qr_gross_before/after: Doanh số tháng xét bậc trước và sau khi cộng giao dịch này.
     */
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
 * Tính chi tiết phí chuyển tiền P2P chiều đi từ ví MERCHANT sang ví khác.
 * Áp dụng cấu hình riêng cho chuyển tiền của merchant:
 * `transfer_fee_bps` (tỷ lệ %), `transfer_min_fee` (sàn), `transfer_max_fee` (trần).
 * 
 * @param {number} amount - Số tiền chuyển (VND)
 * @param {object} effectiveConfig - Cấu hình phí hiệu lực của merchant gửi
 * @returns {object} Chi tiết phí, thực nhận, số dư trừ và snapshot biểu phí
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
 * Tính chi tiết phí rút tiền về ngân hàng liên kết.
 * Nguyên tắc:
 * - Chỉ tính phí trên phần tiền vượt quá hạn mức rút miễn phí tích lũy trong tháng (taxableExcessAmount).
 * - Phần nằm trong hạn mức miễn phí (freeCoveredAmount) có phí = 0 VND.
 * - Ví USER cá nhân mặc định miễn phí rút tiền hoàn toàn.
 * 
 * @param {number} amount - Số tiền muốn rút về ngân hàng (VND)
 * @param {object} effectiveConfig - Cấu hình biểu phí của người rút
 * @param {object} [options]
 * @param {number} [options.alreadyWithdrawn=0] - Tổng số tiền đã rút tích lũy trong tháng hiện tại
 * @param {string} [options.role="MERCHANT"] - Vai trò người rút ('MERCHANT' hoặc 'USER')
 * @returns {object} Chi tiết số tiền, phí rút, tổng tiền trừ khỏi ví, hạn mức còn lại và snapshot
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
 * Hàm tính toán xem trước (preview) phí giao dịch thống nhất cho App Flutter, Web Merchant và Admin CLI (--dry-run).
 * Hỗ trợ tất cả các loại giao dịch:
 * - PAYMENT / QR_PAYMENT: Phí người nhận (Merchant) chịu theo bậc doanh số tháng hoặc gói cước tháng.
 * - WITHDRAW: Phí người rút (Sender) chịu nếu vượt hạn mức rút miễn phí tích lũy trong tháng.
 * - TRANSFER / P2P:
 *   + Người gửi (Merchant hoặc User) chịu phí chuyển (nếu có cấu hình).
 *   + Nếu người nhận là Merchant: tính thêm phí nhận QR inbound từ biểu phí của Merchant nhận.
 * - TOPUP: Miễn phí nạp tiền (0 VND).
 *
 * @param {object} params
 * @param {string} params.transactionType - Loại giao dịch ('PAYMENT', 'QR_PAYMENT', 'WITHDRAW', 'TRANSFER', 'TOPUP')
 * @param {string} [params.role="USER"] - Vai trò của người thực hiện ('USER' hoặc 'MERCHANT')
 * @param {number} params.amount - Số tiền giao dịch (VND)
 * @param {object} [params.effectiveConfig] - Cấu hình biểu phí hiệu lực của người thực hiện
 * @param {number} [params.alreadyWithdrawn=0] - Số tiền đã rút tích lũy trong tháng (dùng cho WITHDRAW)
 * @param {number} [params.alreadyMonthlyGross=0] - Doanh số QR tích lũy trong tháng của người gửi (nếu là Merchant)
 * @param {string} [params.destinationRole=null] - Vai trò của người nhận trong chuyển tiền P2P
 * @param {object} [params.recipientEffectiveConfig=null] - Cấu hình biểu phí của người nhận (nếu nhận là Merchant)
 * @param {number} [params.recipientMonthlyGross=0] - Doanh số tích lũy tháng của người nhận (nếu nhận là Merchant)
 * @param {boolean} [params.monthlyPlanActive=false] - Trạng thái kích hoạt gói tháng của Merchant
 * @param {string} [params.monthlyStatus=MONTHLY_STATUS.INACTIVE] - Trạng thái chi tiết gói tháng
 * @returns {object} Chi tiết kết quả preview gồm: transaction_type, amount, fee_amount, fee_payer, net_amount, total_debit_from_payer, total_receive_by_merchant, exempt_reason, fee_rate_snapshot, withdraw_quota
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

/**
 * Tính toán các thông tin mốc thời gian chu kỳ tháng theo múi giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7).
 * Phục vụ đối soát doanh số tháng, xác định hạn mức rút tiền miễn phí và chu kỳ gia hạn gói cước.
 *
 * @param {number} [nowMs=Date.now()] - Thời điểm cần tính (mili-giây UTC)
 * @returns {{
 *   currentMonth: string,        // Chuỗi tháng hiện tại định dạng "MM/YYYY" (ví dụ: "11/2026")
 *   currentMonthKey: string,     // Khóa tháng hiện tại định dạng "YYYY-MM" (ví dụ: "2026-11")
 *   currentMonthEndDate: string, // Ngày cuối cùng của tháng hiện tại định dạng "DD/MM/YYYY" (ví dụ: "30/11/2026")
 *   nextMonth: string,           // Chuỗi tháng kế tiếp định dạng "MM/YYYY" (ví dụ: "12/2026")
 *   nextMonthKey: string,        // Khóa tháng kế tiếp định dạng "YYYY-MM" (ví dụ: "2026-12")
 *   nextMonthStart: Date,        // Đối tượng Date tại thời điểm 00:00:00 ngày đầu tiên của tháng kế tiếp (theo giờ VN)
 *   nextMonthStartDate: string   // Ngày đầu tiên của tháng kế tiếp định dạng "01/MM/YYYY" (ví dụ: "01/12/2026")
 * }}
 */
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
  assertSystemFeeWalletConfigured,
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
