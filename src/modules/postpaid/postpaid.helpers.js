// postpaid.helpers.js: Các hằng số cấu hình, xử lý ngày/kỳ, thông báo nhắc nợ và dựng payload quy tắc Ví trả sau.
const { uuidv7 } = require("uuidv7");
const { httpError } = require("../../utils/common/http");
const { BANK_FUNDING_MIN_AMOUNT, formatVndDot } = require("../../utils/common/amount");
const {
  VN_OFFSET_MS,
  getVnDateMeta,
  formatYmdToVn,
} = require("../../utils/common/dateRange");
const {
  resolveSystemPostpaidWalletId,
  buildSystemPostpaidWalletSpec,
  assertValidSystemWalletRow,
} = require("../../utils/payment/systemWallet");
const {
  MIN_AUTO_ADJUSTED_CREDIT_LIMIT,
  POSTPAID_LATE_FEE_TIERS,
  resolvePostpaidLimitReductionRule,
  normalizePostpaidConfig,
} = require("./postpaidConfig");
const { normalizePostpaidReminderConfig } = require("./postpaidReminderConfig");

const POSTPAID_SYSTEM_CONFIG_KEYS = Object.freeze({
  CONFIG: "POSTPAID_CONFIG",
  REMINDER_CONFIG: "POSTPAID_REMINDER_CONFIG",
  STATUS: "POSTPAID_STATUS",
  ENTRY_ACTIONS: "POSTPAID_ENTRY_ACTIONS",
});

const STATUS_CATALOG_LABEL = "danh mục trạng thái Ví trả sau";
const ACTION_CATALOG_LABEL = "danh mục loại biến động Ví trả sau";

// Lấy id ví trả sau hệ thống
function assertSystemPostpaidWalletConfigured() {
  return resolveSystemPostpaidWalletId();
}

// Kiểm tra ví trả sau hệ thống
function assertValidSystemPostpaidWalletRow(wallet) {
  return assertValidSystemWalletRow(wallet, buildSystemPostpaidWalletSpec());
}

// Định dạng ngày đến hạn
function buildDueDateStr(year, month, dueDay) {
  const clampedDay = Math.min(28, Math.max(1, Number(dueDay) || 5));
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${year}-${pad2(month)}-${pad2(clampedDay)}`;
}

// Định dạng chu kỳ tháng
function formatCycleMonthDisplay(cycleMonth) {
  const raw = String(cycleMonth || "").trim();
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  return match ? `${match[2]}/${match[1]}` : raw;
}

// Chuyển đổi sang định dạng ngày tháng YYYY-MM-DD
function toYmdStr(val) {
  if (!val) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
    if (match) return match[1];
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime())
      ? null
      : getVnDateMeta(parsed.getTime()).todayDateStr;
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

// Tính số ngày chênh lệch giữa 2 mốc thời gian
function diffDaysYmd(laterVal, earlierVal) {
  const laterYmd = toYmdStr(laterVal);
  const earlierYmd = toYmdStr(earlierVal);
  if (!laterYmd || !earlierYmd) return 0;
  const [ay, am, ad] = laterYmd.split("-").map(Number);
  const [by, bm, bd] = earlierYmd.split("-").map(Number);
  const utcA = Date.UTC(ay, am - 1, ad);
  const utcB = Date.UTC(by, bm - 1, bd);
  return Math.floor((utcA - utcB) / 86400000);
}

function formatVnDateFromYmd(ymd) {
  return formatYmdToVn(toYmdStr(ymd) || String(ymd || "").trim());
}

function computeAutoAdjustedCreditLimit(oldCreditLimit, daysOverdue) {
  const safeLimit = Math.max(0, Math.trunc(Number(oldCreditLimit) || 0));
  const rule = resolvePostpaidLimitReductionRule(daysOverdue);
  if (
    !rule ||
    rule.reductionPercent <= 0 ||
    safeLimit <= MIN_AUTO_ADJUSTED_CREDIT_LIMIT
  ) {
    return safeLimit;
  }
  const rawReduced = Math.floor(
    (safeLimit * (100 - rule.reductionPercent)) / 100,
  );
  return Math.max(MIN_AUTO_ADJUSTED_CREDIT_LIMIT, rawReduced);
}

function renderReminderTemplate(templateText, vars) {
  return String(templateText).replace(
    /\{\{([a-z0-9_]+)\}\}/gi,
    (match, rawKey) => {
      const key = String(rawKey || "").toLowerCase();
      return Object.prototype.hasOwnProperty.call(vars, key)
        ? vars[key]
        : match;
    },
  );
}

function buildMonthlyDebtReminderNotification(
  row,
  { cycleMonth = null, templates } = {},
) {
  if (
    !templates ||
    !templates.PAST_DUE ||
    !templates.BILLED ||
    !templates.UNBILLED
  ) {
    throw httpError(
      500,
      "Hệ thống chưa thiết lập đầy đủ mẫu nội dung nhắc nợ Ví trả sau",
    );
  }

  const usedAmount = Math.max(0, Math.trunc(Number(row?.used_amount) || 0));
  const billedAmount = Math.max(0, Math.trunc(Number(row?.billed_amount) || 0));
  const serviceFeeAmount = Math.max(
    0,
    Math.trunc(Number(row?.service_fee_amount) || 0),
  );
  const lateFeeAmount = Math.max(
    0,
    Math.trunc(Number(row?.late_fee_amount) || 0),
  );
  const statementDebt = billedAmount + serviceFeeAmount + lateFeeAmount;
  const unbilledAmount = Math.max(0, usedAmount - statementDebt);
  const cycleDisplay = formatCycleMonthDisplay(row?.current_cycle_month);
  const dueDateDisplay = formatVnDateFromYmd(row?.due_date_str);

  const cyclePart = cycleDisplay ? ` kỳ ${cycleDisplay}` : "";
  const duePart = dueDateDisplay ? ` trước ngày ${dueDateDisplay}` : "";
  const unbilledPart =
    unbilledAmount > 0
      ? ` (tổng dư nợ hiện tại: ${formatVndDot(usedAmount)})`
      : "";
  const overdueDetail = [
    cycleDisplay ? `kỳ ${cycleDisplay}` : "",
    "quá hạn",
    dueDateDisplay ? `từ ngày ${dueDateDisplay}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const vars = {
    used_amount: formatVndDot(usedAmount),
    statement_debt: formatVndDot(statementDebt),
    billed_amount: formatVndDot(billedAmount),
    service_fee_amount: formatVndDot(serviceFeeAmount),
    late_fee_amount: formatVndDot(lateFeeAmount),
    unbilled_amount: formatVndDot(unbilledAmount),
    cycle_month: cycleDisplay,
    due_date: dueDateDisplay,
    reminder_month: formatCycleMonthDisplay(cycleMonth),
    cycle_part: cyclePart,
    due_part: duePart,
    unbilled_part: unbilledPart,
    overdue_detail: overdueDetail,
  };

  const templateKey =
    row?.status === "PAST_DUE"
      ? "PAST_DUE"
      : statementDebt > 0
        ? "BILLED"
        : "UNBILLED";
  const selectedTemplate = templates[templateKey];

  return {
    title: renderReminderTemplate(selectedTemplate.title, vars).trim(),
    body: renderReminderTemplate(selectedTemplate.body, vars).trim(),
    data: {
      type: "POSTPAID_MONTHLY_REMINDER",
      reminder_month: cycleMonth ? String(cycleMonth) : "",
      postpaid_status: String(row?.status || ""),
      used_amount: String(usedAmount),
      billed_amount: String(billedAmount),
      service_fee_amount: String(serviceFeeAmount),
      late_fee_amount: String(lateFeeAmount),
      due_date: String(row?.due_date_str || ""),
    },
  };
}

function normalizePostpaidCatalog(raw, categoryLabel) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw httpError(500, `Cấu hình ${categoryLabel} trong hệ thống không hợp lệ`);
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw httpError(500, `Hệ thống chưa thiết lập đầy đủ ${categoryLabel}`);
  }
  const codes = {};
  const labels = {};
  for (const [key, val] of entries) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey || typeof val !== "string" || !val.trim()) {
      throw httpError(
        500,
        `Cấu hình ${categoryLabel} trong hệ thống không hợp lệ`,
      );
    }
    codes[cleanKey] = cleanKey;
    labels[cleanKey] = val.trim();
  }
  return {
    codes: Object.freeze(codes),
    labels: Object.freeze(labels),
  };
}

// Lấy cấu hình hệ thống theo key trong db
function requireCatalogCode(codes, key, categoryLabel) {
  if (!codes || !Object.prototype.hasOwnProperty.call(codes, key)) {
    throw httpError(500, `Hệ thống chưa thiết lập đầy đủ ${categoryLabel}`);
  }
  return codes[key];
}

async function lockUsersByIdsOrdered(client, rawIds) {
  const ids = [...new Set(rawIds.map((x) => String(x)).filter(Boolean))].sort();
  if (ids.length === 0) return new Map();
  const res = await client.query(
    `SELECT id, role, status, full_name, phone, balance, created_at,
            EXTRACT(EPOCH FROM (NOW() - created_at)) AS account_age_seconds
       FROM users
      WHERE id = ANY($1::uuid[])
      ORDER BY id ASC
      FOR UPDATE`,
    [ids],
  );
  const byId = new Map();
  for (const row of res.rows) {
    byId.set(String(row.id), row);
  }
  return byId;
}

function resolveActivationEligibility({
  user,
  isKyc,
  hasLinkedBank,
  config,
}) {
  const requiredDays = Math.max(1, Number(config.min_account_days || 0));
  const requiredHours = requiredDays * 24;
  const requiredSeconds = requiredHours * 3600;
  const ageSeconds = Math.max(0, Number(user?.account_age_seconds || 0));
  const accountAgeHours = Math.floor(ageSeconds / 3600);
  const isAccountAgeEligible = ageSeconds >= requiredSeconds;

  let eligible = true;
  let ineligibleReason = null;
  let statusCode = 200;

  if (!config.enabled) {
    eligible = false;
    statusCode = 503;
    ineligibleReason = "Tính năng Ví trả sau hiện đang tạm bảo trì";
  } else if (!user) {
    eligible = false;
    statusCode = 404;
    ineligibleReason = "Không tìm thấy người dùng";
  } else if (user.role !== "USER") {
    eligible = false;
    statusCode = 403;
    ineligibleReason = "Loại tài khoản này chưa hỗ trợ Ví trả sau";
  } else if (user.status !== "ACTIVE") {
    eligible = false;
    statusCode = 403;
    ineligibleReason = "Tài khoản đang bị khóa hoặc không hoạt động";
  } else if (!isKyc) {
    eligible = false;
    statusCode = 403;
    ineligibleReason = "Vui lòng xác thực danh tính (eKYC) để mở Ví trả sau";
  } else if (!hasLinkedBank) {
    eligible = false;
    statusCode = 403;
    ineligibleReason =
      "Vui lòng liên kết ít nhất 1 tài khoản ngân hàng để mở Ví trả sau";
  } else if (!isAccountAgeEligible) {
    eligible = false;
    statusCode = 403;
    ineligibleReason =
      requiredDays === 1
        ? `Tài khoản cần được tạo ít nhất 24 giờ để mở Ví trả sau (hiện tại: ${accountAgeHours}/24 giờ)`
        : `Tài khoản cần hoạt động tối thiểu ${requiredDays} ngày để mở Ví trả sau`;
  }

  return {
    eligible,
    statusCode,
    ineligibleReason,
    requiredDays,
    requiredHours,
    accountAgeHours,
    isAccountAgeEligible,
  };
}

async function lockSystemPostpaidWalletTx(client, postpaidWalletId) {
  const res = await client.query(
    `SELECT id, role, status, full_name, phone, balance
       FROM users
      WHERE id = $1
      FOR UPDATE`,
    [postpaidWalletId],
  );
  return assertValidSystemPostpaidWalletRow(res.rows[0]);
}

async function recordAudit(client, eventType, payload) {
  await client.query(
    `INSERT INTO audit_outbox (id, event_type, payload) VALUES ($1::uuid, $2, $3::jsonb)`,
    [uuidv7(), eventType, JSON.stringify(payload)],
  );
}

function formatPercentFromBps(bps) {
  const pct = Number(bps) / 100;
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(2)));
}

function buildPostpaidInfoPayload(catalog) {
  const { config, statusLabels, entryActionLabels } = catalog;
  const pastDueLabel = statusLabels.PAST_DUE || "PAST_DUE";
  const activeLabel = statusLabels.ACTIVE || "ACTIVE";
  const frozenLabel = statusLabels.FROZEN || "FROZEN";

  const sampleBilled = 1_000_000;
  const lateFeeTiers = POSTPAID_LATE_FEE_TIERS.map((tierSpec) => {
    const bps = Number(config[tierSpec.key]);
    return {
      tier: tierSpec.tier,
      key: tierSpec.key,
      label: tierSpec.label,
      min_days: tierSpec.minDays,
      max_days: tierSpec.maxDays,
      bps,
      percent: Number((bps / 100).toFixed(2)),
      percent_text: formatPercentFromBps(bps),
      sample_fee: Math.round((sampleBilled * bps) / 10000),
    };
  });
  const sampleAppliedFee = lateFeeTiers[0].sample_fee;
  const minBankRepayText = formatVndDot(BANK_FUNDING_MIN_AMOUNT);
  const serviceFeeRule =
    config.monthly_service_fee > 0
      ? config.free_service_fee_tx_count > 0
        ? `Miễn phí dịch vụ cho ${config.free_service_fee_tx_count} giao dịch thanh toán đầu tiên (tính lũy kế). Từ giao dịch thứ ${config.free_service_fee_tx_count + 1} trở đi, thu ${formatVndDot(config.monthly_service_fee)}/tháng vào ngày chốt sao kê cho mỗi kỳ có phát sinh giao dịch mới (0đ nếu kỳ đó không sử dụng).`
        : `Thu ${formatVndDot(config.monthly_service_fee)}/tháng vào ngày chốt sao kê cho mỗi kỳ có phát sinh giao dịch mới (0đ nếu kỳ đó không sử dụng).`
      : "Miễn phí duy trì dịch vụ Ví trả sau hàng tháng (0đ).";
  const tierSummaryText = lateFeeTiers
    .map((t) => `${t.label}: ${t.percent_text}%`)
    .join(", ");
  const limitReductionSummaryText = POSTPAID_LATE_FEE_TIERS
    .filter((t) => Number(t.limitReductionPercent || 0) > 0)
    .map((t) => `${t.label} giảm ${t.limitReductionPercent}%`)
    .join(", ");

  return {
    source: "system_configs",
    config: {
      enabled: config.enabled,
      default_credit_limit: config.default_credit_limit,
      min_account_days: config.min_account_days,
      billing_day: config.billing_day,
      due_day: config.due_day,
      late_fee_tier1_bps: config.late_fee_tier1_bps,
      late_fee_tier2_bps: config.late_fee_tier2_bps,
      late_fee_tier3_bps: config.late_fee_tier3_bps,
      late_fee_tier4_bps: config.late_fee_tier4_bps,
      monthly_service_fee: config.monthly_service_fee,
      free_service_fee_tx_count: config.free_service_fee_tx_count,
    },
    statement_cycle: {
      billing_day: config.billing_day,
      due_day: config.due_day,
      timezone: "Asia/Ho_Chi_Minh",
      billed_formula: "max(0, used_amount - service_fee_amount - late_fee_amount)",
      summary: `Chốt sao kê tự động từ ngày ${config.billing_day} hàng tháng (múi giờ Việt Nam). Toàn bộ dư nợ gốc đang sử dụng được chốt thành dư nợ gốc kỳ sao kê và cộng phí dịch vụ tháng nếu đủ điều kiện.`,
      due_rule: `Hạn thanh toán là ngày ${config.due_day} của tháng kế tiếp sau kỳ chốt sao kê.`,
      overdue_rule: `Sau ngày ${config.due_day} tháng kế tiếp, nếu dư nợ gốc kỳ sao kê hoặc phí dịch vụ tháng vẫn lớn hơn 0đ, ví chuyển sang trạng thái "${pastDueLabel}" (nếu đang khóa thì giữ nguyên trạng thái khóa), tạm khóa chi tiêu QR mới và tính phí chậm trả theo 4 bậc ngày quá hạn (chỉ thu bù chênh lệch khi sang bậc cao hơn). Quá hạn từ ngày thứ 5 trở lên có dư nợ gốc quá hạn sẽ tự động giảm hạn mức khi tất toán kỳ nợ theo bậc ngày trễ (${limitReductionSummaryText}, tối thiểu còn ${formatVndDot(MIN_AUTO_ADJUSTED_CREDIT_LIMIT)}); từ lần quá hạn thứ 2 trở đi ví chuyển "${frozenLabel}" sau khi trả hết dư nợ kỳ sao kê cho tới khi gửi 1–3 ảnh chứng minh thu nhập và được Quản trị viên duyệt mở lại.`,
    },
    fee_rules: {
      activation_fee: 0,
      qr_payment_fee: 0,
      repayment_fee: 0,
      monthly_service_fee: config.monthly_service_fee,
      free_service_fee_tx_count: config.free_service_fee_tx_count,
      service_fee_rule: serviceFeeRule,
      late_fee_tiers: lateFeeTiers,
      calculation_basis: "billed_amount + service_fee_amount",
      formula: "round((billed_amount + service_fee_amount) * tier_bps / 10000)",
      summary: `Miễn phí (0đ) kích hoạt ví, thanh toán QR bằng Ví trả sau và thanh toán dư nợ. ${serviceFeeRule} Khi quá hạn, phí chậm trả áp dụng theo 4 bậc ngày quá hạn (${tierSummaryText}) trên tổng dư nợ kỳ sao kê chưa trả (nợ gốc đã chốt + phí dịch vụ tháng); mỗi kỳ chỉ thu bù phần chênh lệch khi bước sang bậc mới (tổng phí tối đa theo tỷ lệ bậc cao nhất).`,
      example: {
        billed_amount: sampleBilled,
        applied_fee: sampleAppliedFee,
        tier_samples: lateFeeTiers,
        description: `Ví dụ tổng dư nợ kỳ sao kê (nợ gốc đã chốt + phí dịch vụ tháng) ${formatVndDot(sampleBilled)} quá hạn: ${lateFeeTiers.map((t) => `${t.label} = ${formatVndDot(t.sample_fee)} (${t.percent_text}%)`).join("; ")} — tổng phí tối đa trong kỳ bằng mức của bậc cao nhất đạt tới.`,
      },
    },
    repayment_rules: {
      source_wallet: "MAIN_WALLET",
      supported_funding_sources: ["MAIN_WALLET", "BANK"],
      bank_min_amount: BANK_FUNDING_MIN_AMOUNT,
      priority_order: [
        "LATE_FEE",
        "SERVICE_FEE",
        "BILLED_PRINCIPAL",
        "UNBILLED_PRINCIPAL",
      ],
      summary: `Thanh toán dư nợ từ Ví chính hoặc tài khoản ngân hàng liên kết (tối thiểu ${minBankRepayText}/lần khi trả qua ngân hàng) theo thứ tự ưu tiên: (1) Phí trễ hạn → (2) Phí dịch vụ tháng → (3) Dư nợ gốc đã chốt kỳ sao kê → (4) Dư nợ gốc phát sinh kỳ mới.`,
      unlock_rule: `Lần quá hạn đầu tiên: ví đang "${pastDueLabel}" tự động trở lại "${activeLabel}" ngay khi phí trễ hạn, phí dịch vụ tháng và dư nợ gốc đã chốt đều bằng 0đ (trừ trường hợp bị Quản trị viên khóa). Từ lần quá hạn thứ 2 trở đi, sau khi tất toán xong kỳ nợ, ví chuyển "${frozenLabel}" và yêu cầu gửi 1–3 ảnh chứng minh thu nhập để Quản trị viên xét duyệt mở lại.`,
    },
    activation_rules: (() => {
      const effectiveMinDays = Math.max(1, config.min_account_days);
      const minAgeText =
        effectiveMinDays === 1
          ? "được tạo tối thiểu 24 giờ"
          : `hoạt động tối thiểu ${effectiveMinDays} ngày`;
      return {
        enabled: config.enabled,
        allowed_role: "USER",
        kyc_required: true,
        bank_link_required: true,
        min_account_days: config.min_account_days,
        min_account_hours: effectiveMinDays * 24,
        default_credit_limit: config.default_credit_limit,
        summary: `Áp dụng cho tài khoản cá nhân đang hoạt động, đã xác thực eKYC, đã liên kết ít nhất 1 tài khoản ngân hàng đang hoạt động và ${minAgeText}. Hạn mức mặc định ${formatVndDot(config.default_credit_limit)}.`,
      };
    })(),
    status_labels: statusLabels,
    entry_action_labels: entryActionLabels,
  };
}

function removePostpaidDiacritics(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function resolvePostpaidEntryActionFilter(rawAction, entryActions) {
  if (!rawAction || !String(rawAction).trim()) return null;
  const available = new Set(
    Array.isArray(entryActions)
      ? entryActions
      : Object.values(entryActions || {}),
  );
  const requestedTokens = String(rawAction)
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  if (requestedTokens.length === 0) return null;

  const resolved = new Set();
  for (const token of requestedTokens) {
    if (token === "REPAY") {
      const repayActions = [
        "REPAY_PRINCIPAL",
        "REPAY_SERVICE_FEE",
        "REPAY_LATE_FEE",
      ].filter((code) => available.has(code));
      if (repayActions.length === 0) {
        throw httpError(400, "Loại biến động Ví trả sau không hợp lệ");
      }
      repayActions.forEach((code) => resolved.add(code));
      continue;
    }

    if (!available.has(token)) {
      throw httpError(400, "Loại biến động Ví trả sau không hợp lệ");
    }
    resolved.add(token);
  }

  return Array.from(resolved);
}

function findMatchingPostpaidActions(entryActionLabels, keyword) {
  if (!keyword || !entryActionLabels) return null;
  const cleanKw = removePostpaidDiacritics(keyword.trim());
  if (!cleanKw) return null;

  const matched = [];
  for (const [code, label] of Object.entries(entryActionLabels)) {
    const cleanLabel = removePostpaidDiacritics(label);
    const cleanCode = code.toLowerCase();
    if (cleanLabel.includes(cleanKw) || cleanCode.includes(cleanKw)) {
      matched.push(code);
    }
  }
  return matched.length > 0 ? matched : null;
}

module.exports = {
  VN_OFFSET_MS,
  POSTPAID_SYSTEM_CONFIG_KEYS,
  STATUS_CATALOG_LABEL,
  ACTION_CATALOG_LABEL,
  buildSystemPostpaidWalletSpec,
  normalizePostpaidConfig,
  normalizePostpaidReminderConfig,
  assertSystemPostpaidWalletConfigured,
  assertValidSystemPostpaidWalletRow,
  getVnDateMeta,
  buildDueDateStr,
  formatCycleMonthDisplay,
  toYmdStr,
  diffDaysYmd,
  formatVnDateFromYmd,
  computeAutoAdjustedCreditLimit,
  renderReminderTemplate,
  buildMonthlyDebtReminderNotification,
  normalizePostpaidCatalog,
  requireCatalogCode,
  lockUsersByIdsOrdered,
  resolveActivationEligibility,
  lockSystemPostpaidWalletTx,
  recordAudit,
  formatVndDot,
  formatPercentFromBps,
  buildPostpaidInfoPayload,
  removePostpaidDiacritics,
  resolvePostpaidEntryActionFilter,
  findMatchingPostpaidActions,
};

