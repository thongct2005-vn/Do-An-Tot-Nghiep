require("dotenv").config();
const pool = require("../../config/database");
const { httpError } = require("../../utils/httpError");
const { assertDailyLimit, assertWalletCapacity } = require("../../utils/limits/dailyLimit");
const paymentRequestRepository = require("../paymentRequest/paymentRequest.repository");
const webhookRepository = require("../webhook/webhook.repository");
const merchantFeeService = require("../merchant/production/fee/fee.service");
const {
  FEE_TYPES,
  assertSystemFeeWalletConfigured,
} = require("../fee/feeCalculator");
const {
  assertValidSystemWalletRow,
  verifySystemWalletInDb,
} = require("../../utils/systemWallet");
const { uuidv7 } = require("uuidv7");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const POSTPAID_SYSTEM_CONFIG_KEYS = Object.freeze({
  CONFIG: "POSTPAID_CONFIG",
  STATUS: "POSTPAID_STATUS",
  ENTRY_ACTIONS: "POSTPAID_ENTRY_ACTIONS",
});

const STATUS_CATALOG_LABEL = "danh mục trạng thái Ví trả sau";
const ACTION_CATALOG_LABEL = "danh mục loại biến động Ví trả sau";
const SYSTEM_POSTPAID_WALLET_SPEC = Object.freeze({
  expectedRole: "SYSTEM",
  expectedFullName: "SYSTEM_POSTPAID_WALLET",
  expectedPhone: "SYS_BNPL_1",
  activeStatus: "ACTIVE",
  displayLabel: "ví nguồn Ví trả sau",
  inactiveMessage: "Ví nguồn hệ thống Ví trả sau chưa sẵn sàng",
});

function assertSystemPostpaidWalletConfigured() {
  const walletId = String(process.env.SYSTEM_POSTPAID_WALLET_ID || "").trim();
  if (!walletId || !UUID_RE.test(walletId)) {
    throw httpError(500, "Hệ thống chưa thiết lập cấu hình ví nguồn Ví trả sau");
  }
  return walletId;
}

function assertValidSystemPostpaidWalletRow(wallet) {
  return assertValidSystemWalletRow(wallet, SYSTEM_POSTPAID_WALLET_SPEC);
}

function getVnDateMeta(nowMs = Date.now()) {
  const vnNow = new Date(nowMs + VN_OFFSET_MS);
  const year = vnNow.getUTCFullYear();
  const month = vnNow.getUTCMonth() + 1;
  const day = vnNow.getUTCDate();
  const pad2 = (n) => String(n).padStart(2, "0");

  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonthNum = month === 12 ? 1 : month + 1;

  return {
    year,
    month,
    day,
    cycleMonth: `${year}-${pad2(month)}`,
    todayDateStr: `${year}-${pad2(month)}-${pad2(day)}`,
    nextMonthYear,
    nextMonthNum,
  };
}

function buildDueDateStr(year, month, dueDay) {
  const clampedDay = Math.min(28, Math.max(1, Number(dueDay) || 5));
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${year}-${pad2(month)}-${pad2(clampedDay)}`;
}

function formatCycleMonthDisplay(cycleMonth) {
  const raw = String(cycleMonth || "").trim();
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  return match ? `${match[2]}/${match[1]}` : raw;
}

const POSTPAID_CONFIG_FIELD_LABELS = Object.freeze({
  default_credit_limit: "hạn mức mặc định của Ví trả sau",
  min_account_days: "số ngày hoạt động tối thiểu để mở Ví trả sau",
  billing_day: "ngày chốt sao kê Ví trả sau",
  due_day: "ngày đến hạn thanh toán Ví trả sau",
  late_fee_bps: "tỷ lệ phí trễ hạn Ví trả sau",
  min_late_fee: "phí trễ hạn tối thiểu của Ví trả sau",
});

function parseNonNegIntConfig(raw, fieldName) {
  const label = POSTPAID_CONFIG_FIELD_LABELS[fieldName] || "tham số Ví trả sau";
  const val = raw[fieldName];
  const isMissingString = typeof val === "string" && val.trim() === "";
  if (val === undefined || val === null || isMissingString) {
    throw httpError(500, `Hệ thống chưa thiết lập ${label}`);
  }
  const n =
    typeof val === "number"
      ? val
      : typeof val === "string" && /^-?\d+$/.test(val.trim())
        ? Number(val.trim())
        : NaN;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw httpError(500, `Cấu hình ${label} trong hệ thống không hợp lệ`);
  }
  return n;
}

function normalizePostpaidConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw httpError(500, "Cấu hình Ví trả sau trong hệ thống không hợp lệ");
  }
  if (raw.enabled === undefined || raw.enabled === null) {
    throw httpError(500, "Hệ thống chưa thiết lập trạng thái bật hoặc tắt Ví trả sau");
  }
  if (typeof raw.enabled !== "boolean") {
    throw httpError(500, "Cấu hình trạng thái bật hoặc tắt Ví trả sau không hợp lệ");
  }
  const billingDay = parseNonNegIntConfig(raw, "billing_day");
  const dueDay = parseNonNegIntConfig(raw, "due_day");
  if (billingDay < 1 || billingDay > 28) {
    throw httpError(500, "Cấu hình ngày chốt sao kê Ví trả sau phải từ ngày 1 đến ngày 28");
  }
  if (dueDay < 1 || dueDay > 28) {
    throw httpError(500, "Cấu hình ngày đến hạn thanh toán Ví trả sau phải từ ngày 1 đến ngày 28");
  }
  return {
    enabled: raw.enabled,
    default_credit_limit: parseNonNegIntConfig(raw, "default_credit_limit"),
    min_account_days: parseNonNegIntConfig(raw, "min_account_days"),
    billing_day: billingDay,
    due_day: dueDay,
    late_fee_bps: parseNonNegIntConfig(raw, "late_fee_bps"),
    min_late_fee: parseNonNegIntConfig(raw, "min_late_fee"),
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
      throw httpError(500, `Cấu hình ${categoryLabel} trong hệ thống không hợp lệ`);
    }
    codes[cleanKey] = cleanKey;
    labels[cleanKey] = val.trim();
  }
  return {
    codes: Object.freeze(codes),
    labels: Object.freeze(labels),
  };
}

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
    `SELECT id, role, status, full_name, phone, balance, created_at
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

/**
 * Khóa và xác thực ví nguồn SYSTEM_POSTPAID_WALLET ở cuối giao dịch (trước khi ghi tiền)
 * để tránh giữ lock trên ví dùng chung trong lúc kiểm tra điều kiện nghiệp vụ.
 * Thứ tự khóa toàn hệ thống: USER/MERCHANT (tăng dần UUID) -> SYSTEM_POSTPAID_WALLET -> SYSTEM_FEE_WALLET.
 */
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

function formatVndDot(amount) {
  const num = Math.trunc(Number(amount) || 0);
  return `${String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}đ`;
}

function formatPercentFromBps(bps) {
  const pct = Number(bps) / 100;
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(2)));
}

function buildPostpaidInfoPayload(catalog) {
  const { config, statusLabels, entryActionLabels } = catalog;
  const lateFeePercent = Number((config.late_fee_bps / 100).toFixed(2));
  const lateFeePercentText = formatPercentFromBps(config.late_fee_bps);
  const pastDueLabel = statusLabels.PAST_DUE || "PAST_DUE";
  const activeLabel = statusLabels.ACTIVE || "ACTIVE";

  const sampleBilled = 1_000_000;
  const sampleRateFee = Math.round((sampleBilled * config.late_fee_bps) / 10000);
  const sampleAppliedFee = Math.max(config.min_late_fee, sampleRateFee);

  return {
    source: "system_configs",
    config: {
      enabled: config.enabled,
      default_credit_limit: config.default_credit_limit,
      min_account_days: config.min_account_days,
      billing_day: config.billing_day,
      due_day: config.due_day,
      late_fee_bps: config.late_fee_bps,
      late_fee_percent: lateFeePercent,
      min_late_fee: config.min_late_fee,
    },
    statement_cycle: {
      billing_day: config.billing_day,
      due_day: config.due_day,
      timezone: "Asia/Ho_Chi_Minh",
      billed_formula: "max(0, used_amount - late_fee_amount)",
      summary: `Chốt sao kê tự động vào ngày ${config.billing_day} hàng tháng. Toàn bộ dư nợ gốc đang sử dụng được chốt thành dư nợ kỳ sao kê.`,
      due_rule: `Hạn thanh toán là ngày ${config.due_day} của tháng kế tiếp sau kỳ chốt sao kê.`,
      overdue_rule: `Sau ngày ${config.due_day} tháng kế tiếp, nếu dư nợ kỳ sao kê vẫn lớn hơn 0đ, ví chuyển sang trạng thái "${pastDueLabel}", tạm khóa chi tiêu QR mới và tính phí trễ hạn.`,
    },
    fee_rules: {
      activation_fee: 0,
      qr_payment_fee: 0,
      repayment_fee: 0,
      late_fee_bps: config.late_fee_bps,
      late_fee_percent: lateFeePercent,
      min_late_fee: config.min_late_fee,
      calculation_basis: "billed_amount",
      formula: "max(min_late_fee, round(billed_amount * late_fee_bps / 10000))",
      summary: `Miễn phí (0đ) kích hoạt ví, thanh toán QR bằng Ví trả sau và thanh toán dư nợ. Khi quá hạn, phí trễ hạn tính ${lateFeePercentText}% trên dư nợ kỳ sao kê chưa trả (tối thiểu ${formatVndDot(config.min_late_fee)}).`,
      example: {
        billed_amount: sampleBilled,
        rate_fee: sampleRateFee,
        applied_fee: sampleAppliedFee,
        description: `Ví dụ: dư nợ kỳ sao kê ${formatVndDot(sampleBilled)} quá hạn → ${formatVndDot(sampleBilled)} × ${lateFeePercentText}% = ${formatVndDot(sampleRateFee)}, áp dụng tối thiểu ${formatVndDot(config.min_late_fee)} ⇒ phí trễ hạn ${formatVndDot(sampleAppliedFee)}.`,
      },
    },
    repayment_rules: {
      source_wallet: "MAIN_WALLET",
      priority_order: ["LATE_FEE", "BILLED_PRINCIPAL", "UNBILLED_PRINCIPAL"],
      summary: `Thanh toán dư nợ từ Ví chính theo thứ tự ưu tiên: (1) Phí trễ hạn → (2) Dư nợ gốc đã chốt kỳ sao kê → (3) Dư nợ gốc phát sinh kỳ mới.`,
      unlock_rule: `Ví đang "${pastDueLabel}" tự động trở lại "${activeLabel}" ngay khi phí trễ hạn và dư nợ kỳ sao kê đều bằng 0đ.`,
    },
    activation_rules: {
      enabled: config.enabled,
      allowed_role: "USER",
      kyc_required: true,
      min_account_days: config.min_account_days,
      default_credit_limit: config.default_credit_limit,
      summary:
        config.min_account_days > 0
          ? `Áp dụng cho tài khoản cá nhân đang hoạt động, đã xác thực eKYC và hoạt động tối thiểu ${config.min_account_days} ngày. Hạn mức mặc định ${formatVndDot(config.default_credit_limit)}.`
          : `Áp dụng cho tài khoản cá nhân đang hoạt động và đã xác thực eKYC. Hạn mức mặc định ${formatVndDot(config.default_credit_limit)}.`,
    },
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
      const repayActions = ["REPAY_PRINCIPAL", "REPAY_LATE_FEE"].filter((code) =>
        available.has(code),
      );
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

const postpaidRepository = {
  async getSystemCatalog(db = pool) {
    const keys = [
      POSTPAID_SYSTEM_CONFIG_KEYS.CONFIG,
      POSTPAID_SYSTEM_CONFIG_KEYS.STATUS,
      POSTPAID_SYSTEM_CONFIG_KEYS.ENTRY_ACTIONS,
    ];
    const res = await db.query(
      `SELECT key, value FROM system_configs WHERE key = ANY($1::text[])`,
      [keys],
    );
    const configMap = new Map(res.rows.map((r) => [r.key, r.value]));

    if (!configMap.has(POSTPAID_SYSTEM_CONFIG_KEYS.CONFIG)) {
      throw httpError(500, "Hệ thống chưa thiết lập cấu hình Ví trả sau");
    }
    if (!configMap.has(POSTPAID_SYSTEM_CONFIG_KEYS.STATUS)) {
      throw httpError(500, `Hệ thống chưa thiết lập ${STATUS_CATALOG_LABEL}`);
    }
    if (!configMap.has(POSTPAID_SYSTEM_CONFIG_KEYS.ENTRY_ACTIONS)) {
      throw httpError(500, `Hệ thống chưa thiết lập ${ACTION_CATALOG_LABEL}`);
    }

    const config = normalizePostpaidConfig(
      configMap.get(POSTPAID_SYSTEM_CONFIG_KEYS.CONFIG),
    );
    const statusCatalog = normalizePostpaidCatalog(
      configMap.get(POSTPAID_SYSTEM_CONFIG_KEYS.STATUS),
      STATUS_CATALOG_LABEL,
    );
    const entryActionCatalog = normalizePostpaidCatalog(
      configMap.get(POSTPAID_SYSTEM_CONFIG_KEYS.ENTRY_ACTIONS),
      ACTION_CATALOG_LABEL,
    );

    return {
      config,
      statuses: statusCatalog.codes,
      statusLabels: statusCatalog.labels,
      entryActions: entryActionCatalog.codes,
      entryActionLabels: entryActionCatalog.labels,
    };
  },

  async verifySystemPostpaidWallet(db = pool) {
    return verifySystemWalletInDb(db, {
      walletId: assertSystemPostpaidWalletConfigured(),
      otherSystemWalletId: process.env.SYSTEM_FEE_WALLET_ID,
      collisionMessage:
        "Ví thu phí hệ thống và ví nguồn Ví trả sau không được trùng ID",
      spec: SYSTEM_POSTPAID_WALLET_SPEC,
    });
  },

  async getConfig(db = pool) {
    const catalog = await postpaidRepository.getSystemCatalog(db);
    return catalog.config;
  },

  async getWalletInfo(db = pool) {
    const catalog = await postpaidRepository.getSystemCatalog(db);
    return buildPostpaidInfoPayload(catalog);
  },

  async getWalletOverview(userId, db = pool) {
    const [catalog, userRes, kycRes, walletRes] = await Promise.all([
      postpaidRepository.getSystemCatalog(db),
      db.query(
        `SELECT id, role, status, balance, created_at,
                FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)::int AS account_age_days
           FROM users
          WHERE id = $1`,
        [userId],
      ),
      db.query(
        `SELECT 1 FROM user_kyc WHERE user_id = $1 AND status = 'APPROVED' LIMIT 1`,
        [userId],
      ),
      db.query(
        `SELECT user_id, status, credit_limit, used_amount, billed_amount,
                late_fee_amount, current_cycle_month, due_date, activated_at, updated_at
           FROM postpaid_wallets
          WHERE user_id = $1`,
        [userId],
      ),
      postpaidRepository.verifySystemPostpaidWallet(db),
    ]);

    const { config, statuses, statusLabels, entryActionLabels } = catalog;
    const user = userRes.rows[0];
    if (!user) {
      throw httpError(404, "Không tìm thấy thông tin người dùng");
    }

    const isKyc = kycRes.rows.length > 0;
    const accountAgeDays = Math.max(0, Number(user.account_age_days || 0));
    const pw = walletRes.rows[0] || null;

    let eligible = true;
    let ineligibleReason = null;
    if (!config.enabled) {
      eligible = false;
      ineligibleReason = "Tính năng Ví trả sau hiện đang tạm bảo trì";
    } else if (user.role !== "USER") {
      eligible = false;
      ineligibleReason = "Loại tài khoản này chưa hỗ trợ Ví trả sau";
    } else if (user.status !== "ACTIVE") {
      eligible = false;
      ineligibleReason = "Tài khoản đang bị khóa hoặc không hoạt động";
    } else if (!isKyc) {
      eligible = false;
      ineligibleReason = "Vui lòng xác thực danh tính (eKYC) để mở Ví trả sau";
    } else if (accountAgeDays < config.min_account_days) {
      eligible = false;
      ineligibleReason = `Tài khoản cần hoạt động tối thiểu ${config.min_account_days} ngày`;
    }

    const creditLimit = pw ? Number(pw.credit_limit) : config.default_credit_limit;
    const usedAmount = pw ? Number(pw.used_amount) : 0;
    const billedAmount = pw ? Number(pw.billed_amount) : 0;
    const lateFeeAmount = pw ? Number(pw.late_fee_amount) : 0;
    const unbilledAmount = pw
      ? Math.max(0, usedAmount - billedAmount - lateFeeAmount)
      : 0;
    const availableLimit = pw ? Math.max(0, creditLimit - usedAmount) : 0;
    const currentStatus = pw
      ? pw.status
      : requireCatalogCode(statuses, "INACTIVE", STATUS_CATALOG_LABEL);
    const currentStatusLabel = requireCatalogCode(
      statusLabels,
      currentStatus,
      STATUS_CATALOG_LABEL,
    );

    return {
      activated: Boolean(pw),
      is_kyc: isKyc,
      eligible_to_activate: !pw && eligible,
      ineligible_reason: pw ? null : ineligibleReason,
      status: currentStatus,
      status_label: currentStatusLabel,
      credit_limit: creditLimit,
      used_amount: usedAmount,
      available_limit: availableLimit,
      billed_amount: billedAmount,
      late_fee_amount: lateFeeAmount,
      unbilled_amount: unbilledAmount,
      current_cycle_month: pw?.current_cycle_month || null,
      due_date: pw?.due_date || null,
      activated_at: pw?.activated_at || null,
      updated_at: pw?.updated_at || null,
      main_balance: Number(user.balance),
      config,
      status_labels: statusLabels,
      entry_action_labels: entryActionLabels,
    };
  },

  async activateWallet({ userId }) {
    const [{ config, statuses }] = await Promise.all([
      postpaidRepository.getSystemCatalog(pool),
      postpaidRepository.verifySystemPostpaidWallet(pool),
    ]);
    if (!config.enabled) {
      throw httpError(503, "Tính năng Ví trả sau hiện đang tạm bảo trì");
    }
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const usersMap = await lockUsersByIdsOrdered(client, [userId]);
      const user = usersMap.get(String(userId));
      if (!user) {
        throw httpError(404, "Không tìm thấy người dùng");
      }
      if (user.role !== "USER") {
        throw httpError(403, "Loại tài khoản này chưa hỗ trợ Ví trả sau");
      }
      if (user.status !== "ACTIVE") {
        throw httpError(403, "Tài khoản đang bị khóa hoặc không khả dụng");
      }

      const kycRes = await client.query(
        `SELECT 1 FROM user_kyc WHERE user_id = $1 AND status = 'APPROVED' LIMIT 1`,
        [userId],
      );
      if (kycRes.rows.length === 0) {
        throw httpError(403, "Tài khoản chưa xác thực danh tính (eKYC)");
      }

      const ageRes = await client.query(
        `SELECT FLOOR(EXTRACT(EPOCH FROM (NOW() - $1::timestamptz)) / 86400)::int AS age_days`,
        [user.created_at],
      );
      const ageDays = Math.max(0, Number(ageRes.rows[0]?.age_days || 0));
      if (ageDays < config.min_account_days) {
        throw httpError(
          403,
          `Tài khoản cần hoạt động tối thiểu ${config.min_account_days} ngày để mở Ví trả sau`,
        );
      }

      const existingRes = await client.query(
        `SELECT user_id FROM postpaid_wallets WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      if (existingRes.rows[0]) {
        throw httpError(409, "Ví trả sau đã được kích hoạt trước đó");
      }

      await client.query(
        `INSERT INTO postpaid_wallets (
           user_id, status, credit_limit, used_amount, billed_amount, late_fee_amount
         )
         VALUES ($1, $2, $3, 0, 0, 0)`,
        [userId, activeStatus, config.default_credit_limit],
      );

      await recordAudit(client, "POSTPAID_ACTIVATED", {
        user_id: userId,
        credit_limit: config.default_credit_limit,
      });

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return postpaidRepository.getWalletOverview(userId);
  },
  async getEntries(
    userId,
    {
      cursorId = null,
      limit = 20,
      keyword = null,
      action = null,
      startDate = null,
      endDate = null,
    } = {},
    db = pool,
  ) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 50);
    const validCursorId =
      cursorId && String(cursorId).trim() !== "" ? String(cursorId).trim() : null;
    if (validCursorId && !UUID_RE.test(validCursorId)) {
      throw httpError(400, "cursor_id không hợp lệ");
    }
    const hasCursor = Boolean(validCursorId);

    const trimmedKeyword = keyword && String(keyword).trim() ? String(keyword).trim() : null;
    const hasKeyword = Boolean(trimmedKeyword);
    const safeKeyword = hasKeyword
      ? trimmedKeyword.replace(/[\\%_]/g, "\\$&")
      : null;

    const hasStartDate = Boolean(startDate);
    const hasEndDate = Boolean(endDate);

    const catalog = await postpaidRepository.getSystemCatalog(db);
    const { entryActions, entryActionLabels } = catalog;
    const filteredActions = resolvePostpaidEntryActionFilter(action, entryActions);
    const hasActions = Boolean(filteredActions && filteredActions.length > 0);
    const keywordMatchedActions = hasKeyword
      ? findMatchingPostpaidActions(entryActionLabels, trimmedKeyword)
      : null;

    const res = await db.query(
      `WITH cursor_ref AS (
         SELECT c.created_at
           FROM postpaid_entries c
          WHERE $2::boolean = true AND c.id = $3::uuid
          LIMIT 1
       )
       SELECT
         pe.id,
         pe.user_id,
         pe.tx_id,
         pe.ref_tx_id,
         pe.action,
         pe.amount,
         pe.delta_used,
         pe.used_before,
         pe.used_after,
         pe.cycle_month,
         pe.note,
         pe.created_at,
         COALESCE(du.full_name, su.full_name) AS counterparty_name,
         pr.order_id AS order_id
       FROM postpaid_entries pe
       LEFT JOIN transactions t ON t.id = COALESCE(pe.tx_id, pe.ref_tx_id)
       LEFT JOIN users du ON du.id = t.destination_user_id AND du.role <> 'SYSTEM'
       LEFT JOIN users su ON su.id = t.source_user_id AND su.role <> 'SYSTEM'
       LEFT JOIN payment_requests pr ON pr.transaction_id = COALESCE(pe.ref_tx_id, t.id)
       WHERE pe.user_id = $1
         AND (
           $2::boolean = false
           OR (pe.created_at, pe.id) < ((SELECT created_at FROM cursor_ref), $3::uuid)
         )
         AND ($7::boolean = false OR pe.created_at >= (($8::text)::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
         AND ($9::boolean = false OR pe.created_at < ((($10::text)::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
         AND ($11::boolean = false OR pe.action = ANY($12::text[]))
         AND (
           $5::boolean = false
           OR pe.id::text ILIKE '%' || $6 || '%'
           OR COALESCE(pe.tx_id, '') ILIKE '%' || $6 || '%'
           OR COALESCE(pe.ref_tx_id, '') ILIKE '%' || $6 || '%'
           OR COALESCE(pe.cycle_month, '') ILIKE '%' || $6 || '%'
           OR unaccent(COALESCE(pe.note, '')) ILIKE '%' || unaccent($6) || '%'
           OR COALESCE(pr.order_id, '') ILIKE '%' || $6 || '%'
           OR unaccent(COALESCE(du.full_name, su.full_name, '')) ILIKE '%' || unaccent($6) || '%'
           OR ('thanh toan ' || unaccent(COALESCE(du.full_name, su.full_name, ''))) ILIKE '%' || unaccent($6) || '%'
           OR ('hoan tien tu ' || unaccent(COALESCE(su.full_name, du.full_name, ''))) ILIKE '%' || unaccent($6) || '%'
           OR ($6 ~ '^[0-9.]+$' AND pe.amount::text LIKE '%' || REPLACE($6, '.', '') || '%')
           OR ($6 ~ '[/:-]' AND TO_CHAR(pe.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI - DD/MM/YYYY') ILIKE '%' || $6 || '%')
           OR (
             $6 ~ '[-/]'
             AND pe.cycle_month ~ '^\\d{4}-\\d{2}$'
             AND (
               (SUBSTRING(pe.cycle_month FROM 6 FOR 2) || '-' || LEFT(pe.cycle_month, 4)) ILIKE '%' || $6 || '%'
               OR (SUBSTRING(pe.cycle_month FROM 6 FOR 2) || '/' || LEFT(pe.cycle_month, 4)) ILIKE '%' || $6 || '%'
             )
           )
           OR ($13::text[] IS NOT NULL AND pe.action = ANY($13::text[]))
         )
       ORDER BY pe.created_at DESC, pe.id DESC
       LIMIT $4`,
      [
        userId,
        hasCursor,
        validCursorId,
        safeLimit,
        hasKeyword,
        safeKeyword,
        hasStartDate,
        startDate || null,
        hasEndDate,
        endDate || null,
        hasActions,
        filteredActions,
        keywordMatchedActions,
      ],
    );

    const rows = res.rows.map((row) => ({
      ...row,
      action_label: requireCatalogCode(
        entryActionLabels,
        row.action,
        ACTION_CATALOG_LABEL,
      ),
    }));
    const nextCursor = rows.length === safeLimit ? rows[rows.length - 1].id : null;

    return {
      entries: rows,
      next_cursor: nextCursor,
    };
  },

  async processPostpaidQRPayment({ sourceUserId, referenceCode, idempotencyKey }) {
    const { config, statuses, entryActions } =
      await postpaidRepository.getSystemCatalog(pool);
    if (!config.enabled) {
      throw httpError(503, "Tính năng Ví trả sau hiện đang tạm bảo trì");
    }
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const purchaseAction = requireCatalogCode(
      entryActions,
      "PURCHASE",
      ACTION_CATALOG_LABEL,
    );

    const postpaidWalletId = assertSystemPostpaidWalletConfigured();
    const { walletId: feeWalletId } = assertSystemFeeWalletConfigured();
    if (String(feeWalletId) === String(postpaidWalletId)) {
      throw httpError(
        500,
        "Ví thu phí hệ thống và ví nguồn Ví trả sau không được trùng ID",
      );
    }

    const client = await pool.connect();
    let resultPayload;

    try {
      await client.query("BEGIN");

      const targetRes = await client.query(
        `SELECT destination_user_id FROM payment_requests WHERE reference_code = $1`,
        [referenceCode],
      );
      if (!targetRes.rows[0]) {
        throw httpError(404, "Không tìm thấy mã QR");
      }

      const merchantId = targetRes.rows[0].destination_user_id;
      if (String(sourceUserId) === String(merchantId)) {
        throw httpError(400, "Không thể thanh toán cho chính mình");
      }

      // Luôn khóa ví USER/MERCHANT theo thứ tự UUID tăng dần trước payment_requests & postpaid_wallets;
      // SYSTEM_POSTPAID_WALLET khóa gần cuối (ngay trước khi trừ tiền) và SYSTEM_FEE_WALLET khóa cuối cùng.
      const usersMap = await lockUsersByIdsOrdered(client, [
        sourceUserId,
        merchantId,
      ]);
      const sourceUser = usersMap.get(String(sourceUserId));
      const destUser = usersMap.get(String(merchantId));

      if (!sourceUser || !destUser) {
        throw httpError(404, "Không tìm thấy thông tin người thanh toán hoặc cửa hàng");
      }
      if (sourceUser.status !== "ACTIVE" || sourceUser.role === "SYSTEM") {
        throw httpError(403, "Tài khoản của bạn đang bị khóa hoặc không khả dụng");
      }
      if (destUser.status !== "ACTIVE" || destUser.role === "SYSTEM") {
        throw httpError(422, "Tài khoản người nhận không khả dụng");
      }

      const paymentRequest =
        await paymentRequestRepository.findByReferenceCodeForUpdate(
          client,
          referenceCode,
        );
      if (!paymentRequest) {
        throw httpError(404, "Không tìm thấy mã QR");
      }
      if (paymentRequest.status !== "PENDING") {
        throw httpError(409, "Mã QR không còn chờ thanh toán");
      }
      if (paymentRequest.paid_at != null || paymentRequest.is_expires) {
        throw httpError(400, "Mã QR này đã được thanh toán hoặc hết hạn");
      }

      const amountNum = Number(paymentRequest.amount);
      if (!Number.isSafeInteger(amountNum) || amountNum <= 0) {
        throw httpError(400, "Số tiền đơn thanh toán không hợp lệ");
      }

      const pwRes = await client.query(
        `SELECT user_id, status, credit_limit, used_amount, billed_amount, late_fee_amount
           FROM postpaid_wallets
          WHERE user_id = $1
          FOR UPDATE`,
        [sourceUserId],
      );
      const pw = pwRes.rows[0];
      if (!pw) {
        throw httpError(403, "Bạn chưa kích hoạt Ví trả sau");
      }
      if (pw.status === pastDueStatus) {
        throw httpError(
          403,
          "Ví trả sau đang có dư nợ quá hạn. Vui lòng thanh toán để tiếp tục sử dụng",
        );
      }
      if (pw.status !== activeStatus) {
        throw httpError(403, "Ví trả sau hiện đang tạm khóa");
      }

      const creditLimit = Number(pw.credit_limit);
      const usedBefore = Number(pw.used_amount);
      const availableBefore = creditLimit - usedBefore;
      if (amountNum > availableBefore) {
        throw httpError(422, "Hạn mức Ví trả sau khả dụng không đủ");
      }

      await assertDailyLimit(client, {
        userId: sourceUserId,
        role: sourceUser.role,
        type: "PAYMENT",
        amount: amountNum,
        fee: 0,
      });

      const merchantFeeDetails =
        await merchantFeeService.resolveMerchantTxFeeDetailsTx(client, {
          merchantUser: destUser,
          amount: amountNum,
          transactionType: "PAYMENT",
        });
      const merchantFeeNum = Number(merchantFeeDetails.fee_amount || 0);
      if (!Number.isFinite(merchantFeeNum) || merchantFeeNum < 0 || merchantFeeNum > amountNum) {
        throw httpError(500, "Phí giao dịch merchant không hợp lệ");
      }

      const destBefore = Number(destUser.balance);
      const netAmount = amountNum - merchantFeeNum;
      await assertWalletCapacity(client, {
        userId: destUser.id,
        role: destUser.role,
        currentBalance: destBefore,
        inboundAmount: netAmount,
        isRecipient: true,
      });

      // Đã kiểm tra xong toàn bộ điều kiện nghiệp vụ mới khóa ví nguồn Ví trả sau ở cuối transaction
      const postpaidSysUser = await lockSystemPostpaidWalletTx(
        client,
        postpaidWalletId,
      );
      const sysBefore = Number(postpaidSysUser.balance);
      if (sysBefore < amountNum) {
        throw httpError(503, "Nguồn vốn Ví trả sau tạm thời không đủ");
      }

      const sysAfter = sysBefore - amountNum;
      const destAfter = destBefore + netAmount;
      const usedAfter = usedBefore + amountNum;

      if (sysBefore + destBefore !== sysAfter + destAfter + merchantFeeNum) {
        throw httpError(500, "Lỗi toàn vẹn số dư giao dịch");
      }

      await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
        sysAfter,
        postpaidWalletId,
      ]);
      await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
        destAfter,
        merchantId,
      ]);
      await client.query(
        `UPDATE postpaid_wallets
            SET used_amount = $1,
                updated_at = NOW()
          WHERE user_id = $2`,
        [usedAfter, sourceUserId],
      );

      const description =
        paymentRequest.description || `Thanh toán QR ${referenceCode}`;
      const txInsertRes = await client.query(
        `INSERT INTO transactions (
           transaction_type,
           source_user_id, source_balance_before, source_balance_after,
           destination_user_id, dest_balance_before, dest_balance_after,
           amount, fee, merchant_fee, fee_rate_snapshot, net_amount,
           description, idempotency_key, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10::jsonb, $11, $12, $13, 'SUCCESS')
         RETURNING id, status, created_at`,
        [
          "PAYMENT",
          postpaidWalletId,
          sysBefore,
          sysAfter,
          merchantId,
          destBefore,
          destAfter,
          amountNum,
          merchantFeeNum,
          JSON.stringify(merchantFeeDetails?.fee_rate_snapshot || null),
          netAmount,
          description,
          idempotencyKey,
        ],
      );

      const createdTx = txInsertRes.rows[0];
      const createdTxId = createdTx.id;

      if (merchantFeeNum > 0) {
        await merchantFeeService.creditSystemFeeWalletAndLedgerTx(client, {
          transactionId: createdTxId,
          merchantUserId: destUser.id,
          payerUserId: sourceUserId,
          feeType: FEE_TYPES.QR_FEE,
          amount: merchantFeeNum,
          rateSnapshot: merchantFeeDetails?.fee_rate_snapshot || {},
          idempotencyKey,
        });
      }

      await client.query(
        `INSERT INTO postpaid_entries (
           id, user_id, tx_id, action, amount, delta_used, used_before, used_after, note
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv7(),
          sourceUserId,
          createdTxId,
          purchaseAction,
          amountNum,
          amountNum,
          usedBefore,
          usedAfter,
          description,
        ],
      );

      const paidPr = await paymentRequestRepository.markAsPaid(client, {
        referenceCode,
        sourceUserId,
        transactionId: createdTxId,
      });
      if (!paidPr) {
        throw httpError(409, "Mã QR này đã được thanh toán hoặc hết hạn");
      }

      await webhookRepository.enqueue(client, {
        paymentRequestId: paidPr.id,
        eventType: "payment.success",
      });

      await recordAudit(client, "PAYMENT_PAID", {
        payment_id: paidPr.id,
        order_id: paidPr.order_id ?? null,
        merchant_id: merchantId,
        payer_user_id: sourceUserId,
        funding_source: "POSTPAID",
        transaction_id: createdTxId,
        amount: amountNum,
        merchant_fee: merchantFeeNum,
        net_amount: netAmount,
        postpaid_used_before: usedBefore,
        postpaid_used_after: usedAfter,
      });

      await client.query("COMMIT");

      resultPayload = {
        transactionId: createdTxId,
        status: createdTx.status,
        createdAt: createdTx.created_at,
        amount: amountNum,
        fee: 0,
        feeAmount: 0,
        merchantFee: merchantFeeNum,
        feeRateSnapshot: merchantFeeDetails?.fee_rate_snapshot || null,
        netAmount,
        description,
        sourceUserName: sourceUser.full_name,
        destinationId: destUser.id,
        destinationUserName: destUser.full_name,
        destinationPhone: destUser.phone,
        // Giữ nguyên số dư ví chính để socket/UI ví chính không bị ghi nhầm số dư ví hệ thống
        sourceBalanceAfter: Number(sourceUser.balance),
        destBalanceAfter: destAfter,
        fundingSource: "POSTPAID",
        postpaidUsedAfter: usedAfter,
        postpaidAvailableAfter: creditLimit - usedAfter,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return resultPayload;
  },

  async repayDebt({ userId, amount, idempotencyKey }) {
    const repayAmount = Number(amount);
    if (!Number.isSafeInteger(repayAmount) || repayAmount <= 0) {
      throw httpError(400, "Số tiền thanh toán dư nợ không hợp lệ");
    }

    const { statuses, entryActions } =
      await postpaidRepository.getSystemCatalog(pool);
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const repayLateFeeAction = requireCatalogCode(
      entryActions,
      "REPAY_LATE_FEE",
      ACTION_CATALOG_LABEL,
    );
    const repayPrincipalAction = requireCatalogCode(
      entryActions,
      "REPAY_PRINCIPAL",
      ACTION_CATALOG_LABEL,
    );

    const postpaidWalletId = assertSystemPostpaidWalletConfigured();
    const { walletId: feeWalletId } = assertSystemFeeWalletConfigured();
    if (String(feeWalletId) === String(postpaidWalletId)) {
      throw httpError(
        500,
        "Ví thu phí hệ thống và ví nguồn Ví trả sau không được trùng ID",
      );
    }

    const client = await pool.connect();
    let resultPayload;

    try {
      await client.query("BEGIN");

      // Khóa ví người trả nợ trước; SYSTEM_POSTPAID_WALLET khóa ở cuối sau khi kiểm tra xong điều kiện nợ/số dư
      const usersMap = await lockUsersByIdsOrdered(client, [userId]);
      const user = usersMap.get(String(userId));

      if (!user) {
        throw httpError(404, "Không tìm thấy người dùng");
      }
      if (user.status !== "ACTIVE" || user.role === "SYSTEM") {
        throw httpError(403, "Tài khoản của bạn đang bị khóa hoặc không khả dụng");
      }

      const pwRes = await client.query(
        `SELECT user_id, status, credit_limit, used_amount, billed_amount,
                late_fee_amount, current_cycle_month
           FROM postpaid_wallets
          WHERE user_id = $1
          FOR UPDATE`,
        [userId],
      );
      const pw = pwRes.rows[0];
      if (!pw) {
        throw httpError(404, "Bạn chưa kích hoạt Ví trả sau");
      }

      const creditLimit = Number(pw.credit_limit);
      const oldUsed = Number(pw.used_amount);
      const oldBilled = Number(pw.billed_amount);
      const oldLateFee = Number(pw.late_fee_amount);

      if (oldUsed <= 0) {
        throw httpError(400, "Bạn hiện không có dư nợ Ví trả sau");
      }
      if (repayAmount > oldUsed) {
        throw httpError(400, "Số tiền thanh toán vượt quá tổng dư nợ hiện tại");
      }

      const userBefore = Number(user.balance);
      if (userBefore < repayAmount) {
        throw httpError(422, "Số dư ví chính không đủ để thanh toán dư nợ");
      }

      const paidLateFee = Math.min(repayAmount, oldLateFee);
      const paidPrincipal = repayAmount - paidLateFee;

      const newLateFee = oldLateFee - paidLateFee;
      const billedDeduction = Math.min(paidPrincipal, oldBilled);
      const newBilled = oldBilled - billedDeduction;
      const newUsed = oldUsed - repayAmount;

      if (newBilled + newLateFee > newUsed) {
        throw httpError(500, "Lỗi toàn vẹn công thức trừ nợ Ví trả sau");
      }

      const newStatus =
        pw.status === pastDueStatus &&
        newLateFee === 0 &&
        newBilled === 0
          ? activeStatus
          : pw.status;

      const userAfter = userBefore - repayAmount;
      const sysWallet = await lockSystemPostpaidWalletTx(
        client,
        postpaidWalletId,
      );
      const sysBefore = Number(sysWallet.balance);
      const sysAfter = sysBefore + paidPrincipal;

      await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
        userAfter,
        userId,
      ]);

      if (paidPrincipal > 0) {
        await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
          sysAfter,
          postpaidWalletId,
        ]);
      }

      const description =
        paidLateFee > 0 && paidPrincipal > 0
          ? "Thanh toán dư nợ & phí trễ hạn Ví trả sau"
          : paidLateFee > 0
            ? "Thanh toán phí trễ hạn Ví trả sau"
            : "Thanh toán dư nợ Ví trả sau";

      const hasPrincipal = paidPrincipal > 0;
      const txInsertRes = await client.query(
        `INSERT INTO transactions (
           transaction_type,
           source_user_id, source_balance_before, source_balance_after,
           destination_user_id, dest_balance_before, dest_balance_after,
           amount, fee, merchant_fee, fee_rate_snapshot, net_amount,
           description, idempotency_key, status
         )
         VALUES ('PAYMENT', $1, $2, $3, $4, $5, $6, $7, $8, 0, $9::jsonb, $10, $11, $12, 'SUCCESS')
         RETURNING id, status, created_at`,
        [
          userId,
          userBefore,
          userAfter,
          hasPrincipal ? postpaidWalletId : null,
          hasPrincipal ? sysBefore : null,
          hasPrincipal ? sysAfter : null,
          hasPrincipal ? paidPrincipal : paidLateFee,
          hasPrincipal ? paidLateFee : 0,
          JSON.stringify(
            paidLateFee > 0
              ? {
                  fee_type: FEE_TYPES.POSTPAID_LATE_FEE,
                  cycle_month: pw.current_cycle_month,
                  late_fee_paid: paidLateFee,
                }
              : null,
          ),
          hasPrincipal ? paidPrincipal : paidLateFee,
          description,
          idempotencyKey,
        ],
      );

      const createdTx = txInsertRes.rows[0];
      const createdTxId = createdTx.id;

      if (paidLateFee > 0) {
        await merchantFeeService.creditSystemFeeWalletAndLedgerTx(client, {
          transactionId: createdTxId,
          payerUserId: userId,
          feeType: FEE_TYPES.POSTPAID_LATE_FEE,
          amount: paidLateFee,
          rateSnapshot: {
            cycle_month: pw.current_cycle_month,
            fee_type: FEE_TYPES.POSTPAID_LATE_FEE,
          },
          idempotencyKey,
        });

        await client.query(
          `INSERT INTO postpaid_entries (
             id, user_id, tx_id, action, amount, delta_used, used_before, used_after, cycle_month, note
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv7(),
            userId,
            createdTxId,
            repayLateFeeAction,
            paidLateFee,
            -paidLateFee,
            oldUsed,
            oldUsed - paidLateFee,
            pw.current_cycle_month,
            "Trả phí trễ hạn Ví trả sau",
          ],
        );
      }

      if (paidPrincipal > 0) {
        const usedBeforePrincipal = oldUsed - paidLateFee;
        await client.query(
          `INSERT INTO postpaid_entries (
             id, user_id, tx_id, action, amount, delta_used, used_before, used_after, cycle_month, note
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv7(),
            userId,
            createdTxId,
            repayPrincipalAction,
            paidPrincipal,
            -paidPrincipal,
            usedBeforePrincipal,
            newUsed,
            pw.current_cycle_month,
            "Thanh toán gốc dư nợ Ví trả sau",
          ],
        );
      }

      await client.query(
        `UPDATE postpaid_wallets
            SET used_amount = $1,
                billed_amount = $2,
                late_fee_amount = $3,
                status = $4,
                updated_at = NOW()
          WHERE user_id = $5`,
        [newUsed, newBilled, newLateFee, newStatus, userId],
      );

      await recordAudit(client, "POSTPAID_REPAY", {
        user_id: userId,
        transaction_id: createdTxId,
        repay_amount: repayAmount,
        paid_late_fee: paidLateFee,
        paid_principal: paidPrincipal,
        used_before: oldUsed,
        used_after: newUsed,
        billed_after: newBilled,
        late_fee_after: newLateFee,
        status_after: newStatus,
      });

      await client.query("COMMIT");

      resultPayload = {
        transactionId: createdTxId,
        status: createdTx.status,
        createdAt: createdTx.created_at,
        amount: repayAmount,
        paidPrincipal,
        paidLateFee,
        mainBalanceAfter: userAfter,
        usedAmountAfter: newUsed,
        availableLimitAfter: creditLimit - newUsed,
        billedAmountAfter: newBilled,
        lateFeeAfter: newLateFee,
        postpaidStatus: newStatus,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return resultPayload;
  },

  async refundPostpaidTransaction({
    originalTxId,
    refundAmount = null,
    reason = "",
    actorId = null,
    idempotencyKey = null,
  }) {
    if (!originalTxId || !String(originalTxId).trim()) {
      throw httpError(400, "Thiếu mã giao dịch gốc để hoàn tiền");
    }
    const cleanTxId = String(originalTxId).trim();
    const effectiveIdemKey = idempotencyKey || `postpaid_refund_${uuidv7()}`;

    const { statuses, entryActions } =
      await postpaidRepository.getSystemCatalog(pool);
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const purchaseAction = requireCatalogCode(
      entryActions,
      "PURCHASE",
      ACTION_CATALOG_LABEL,
    );
    const refundAction = requireCatalogCode(
      entryActions,
      "REFUND",
      ACTION_CATALOG_LABEL,
    );
    const statementCloseAction = requireCatalogCode(
      entryActions,
      "STATEMENT_CLOSE",
      ACTION_CATALOG_LABEL,
    );
    const postpaidWalletId = assertSystemPostpaidWalletConfigured();

    const client = await pool.connect();
    let resultPayload;

    try {
      await client.query("BEGIN");

      const txRes = await client.query(
        `SELECT id, transaction_type, source_user_id, destination_user_id, amount,
                merchant_fee, status, created_at
           FROM transactions
          WHERE id = $1
          FOR UPDATE`,
        [cleanTxId],
      );
      const origTx = txRes.rows[0];
      if (!origTx) {
        throw httpError(404, "Không tìm thấy giao dịch gốc");
      }
      if (origTx.status !== "SUCCESS" || origTx.transaction_type !== "PAYMENT") {
        throw httpError(400, "Chỉ hỗ trợ hoàn tiền cho giao dịch thanh toán đã thành công");
      }

      const purchaseRes = await client.query(
        `SELECT id, user_id, amount, cycle_month, created_at
           FROM postpaid_entries
          WHERE tx_id = $1 AND action = $2
          LIMIT 1`,
        [cleanTxId, purchaseAction],
      );
      const purchaseEntry = purchaseRes.rows[0];
      if (!purchaseEntry) {
        throw httpError(400, "Giao dịch này không phải giao dịch thanh toán bằng Ví trả sau");
      }

      const refundedSumRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS refunded_total
           FROM postpaid_entries
          WHERE ref_tx_id = $1 AND action = $2`,
        [cleanTxId, refundAction],
      );
      const alreadyRefunded = Number(refundedSumRes.rows[0]?.refunded_total || 0);
      const originalAmount = Number(origTx.amount);
      const remainingRefundable = originalAmount - alreadyRefunded;
      if (remainingRefundable <= 0) {
        throw httpError(409, "Giao dịch này đã được hoàn đủ trước đó");
      }

      const actualRefundAmount =
        refundAmount === null || refundAmount === undefined
          ? remainingRefundable
          : Number(refundAmount);
      if (
        !Number.isSafeInteger(actualRefundAmount) ||
        actualRefundAmount <= 0
      ) {
        throw httpError(400, "Số tiền hoàn không hợp lệ");
      }
      if (actualRefundAmount > remainingRefundable) {
        throw httpError(400, "Số tiền hoàn vượt quá số tiền còn có thể hoàn");
      }

      const merchantId = origTx.destination_user_id;
      const buyerUserId = purchaseEntry.user_id;
      if (!merchantId) {
        throw httpError(400, "Giao dịch gốc không có tài khoản cửa hàng nhận tiền");
      }

      // Khóa ví merchant và người mua theo thứ tự UUID tăng dần;
      // SYSTEM_POSTPAID_WALLET khóa ở cuối transaction sau khi kiểm tra xong điều kiện hoàn tiền.
      const usersMap = await lockUsersByIdsOrdered(client, [
        merchantId,
        buyerUserId,
      ]);
      const merchant = usersMap.get(String(merchantId));
      const buyer = usersMap.get(String(buyerUserId));

      if (!merchant || !buyer) {
        throw httpError(404, "Không tìm thấy tài khoản liên quan để hoàn tiền");
      }

      const pwRes = await client.query(
        `SELECT user_id, status, credit_limit, used_amount, billed_amount, late_fee_amount
           FROM postpaid_wallets
          WHERE user_id = $1
          FOR UPDATE`,
        [buyerUserId],
      );
      const pw = pwRes.rows[0];
      if (!pw) {
        throw httpError(404, "Không tìm thấy Ví trả sau của người mua");
      }

      const merchantBefore = Number(merchant.balance);
      if (merchantBefore < actualRefundAmount) {
        throw httpError(422, "Số dư của cửa hàng không đủ để thực hiện hoàn tiền");
      }

      const oldUsed = Number(pw.used_amount);
      const oldBilled = Number(pw.billed_amount);
      const oldLateFee = Number(pw.late_fee_amount);

      const creditToReduce = Math.min(actualRefundAmount, oldUsed);
      const excessToMainWallet = actualRefundAmount - creditToReduce;
      const newUsed = oldUsed - creditToReduce;

      // Kiểm tra giao dịch mua gốc đã nằm trước lần chốt sao kê gần nhất chưa
      const stmtRes = await client.query(
        `SELECT created_at
           FROM postpaid_entries
          WHERE user_id = $1 AND action = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [buyerUserId, statementCloseAction],
      );
      const lastStatementCloseAt = stmtRes.rows[0]?.created_at
        ? new Date(stmtRes.rows[0].created_at).getTime()
        : null;
      const purchaseTime = new Date(origTx.created_at).getTime();
      const maxAllowedBilled = Math.max(0, newUsed - oldLateFee);

      let newBilled = oldBilled;
      if (lastStatementCloseAt !== null && purchaseTime <= lastStatementCloseAt) {
        newBilled = Math.max(0, oldBilled - Math.min(creditToReduce, oldBilled));
      }
      if (newBilled > maxAllowedBilled) {
        newBilled = maxAllowedBilled;
      }

      const newStatus =
        pw.status === pastDueStatus &&
        oldLateFee === 0 &&
        newBilled === 0
          ? activeStatus
          : pw.status;

      const buyerBefore = Number(buyer.balance);
      if (excessToMainWallet > 0) {
        await assertWalletCapacity(client, {
          userId: buyerUserId,
          role: buyer.role,
          currentBalance: buyerBefore,
          inboundAmount: excessToMainWallet,
          isRecipient: true,
        });
      }

      let merchantCursorBalance = merchantBefore;
      let primaryRefundTxId = null;
      let excessTxId = null;
      const refundNote =
        (reason && String(reason).trim()) ||
        `Hoàn tiền giao dịch Ví trả sau #${cleanTxId}`;

      if (creditToReduce > 0) {
        const sysWallet = await lockSystemPostpaidWalletTx(
          client,
          postpaidWalletId,
        );
        const sysBefore = Number(sysWallet.balance);
        const mBefore = merchantCursorBalance;
        const mAfter = mBefore - creditToReduce;
        merchantCursorBalance = mAfter;
        const sAfter = sysBefore + creditToReduce;

        await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
          sAfter,
          postpaidWalletId,
        ]);

        const tx1Res = await client.query(
          `INSERT INTO transactions (
             transaction_type,
             source_user_id, source_balance_before, source_balance_after,
             destination_user_id, dest_balance_before, dest_balance_after,
             amount, fee, merchant_fee, net_amount, description, idempotency_key, status
           )
           VALUES ('TRANSFER', $1, $2, $3, $4, $5, $6, $7, 0, 0, $7, $8, $9, 'SUCCESS')
           RETURNING id`,
          [
            merchantId,
            mBefore,
            mAfter,
            postpaidWalletId,
            sysBefore,
            sAfter,
            creditToReduce,
            refundNote,
            excessToMainWallet > 0 ? `${effectiveIdemKey}:postpaid` : effectiveIdemKey,
          ],
        );
        primaryRefundTxId = tx1Res.rows[0].id;
      }

      if (excessToMainWallet > 0) {
        const mBefore = merchantCursorBalance;
        const mAfter = mBefore - excessToMainWallet;
        merchantCursorBalance = mAfter;
        const bAfter = buyerBefore + excessToMainWallet;

        await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
          bAfter,
          buyerUserId,
        ]);

        const tx2Res = await client.query(
          `INSERT INTO transactions (
             transaction_type,
             source_user_id, source_balance_before, source_balance_after,
             destination_user_id, dest_balance_before, dest_balance_after,
             amount, fee, merchant_fee, net_amount, description, idempotency_key, status
           )
           VALUES ('TRANSFER', $1, $2, $3, $4, $5, $6, $7, 0, 0, $7, $8, $9, 'SUCCESS')
           RETURNING id`,
          [
            merchantId,
            mBefore,
            mAfter,
            buyerUserId,
            buyerBefore,
            bAfter,
            excessToMainWallet,
            `${refundNote} (phần dư về ví chính)`,
            creditToReduce > 0 ? `${effectiveIdemKey}:excess` : effectiveIdemKey,
          ],
        );
        excessTxId = tx2Res.rows[0].id;
        if (!primaryRefundTxId) {
          primaryRefundTxId = excessTxId;
        }
      }

      await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
        merchantCursorBalance,
        merchantId,
      ]);

      await client.query(
        `UPDATE postpaid_wallets
            SET used_amount = $1,
                billed_amount = $2,
                status = $3,
                updated_at = NOW()
          WHERE user_id = $4`,
        [newUsed, newBilled, newStatus, buyerUserId],
      );

      await client.query(
        `INSERT INTO postpaid_entries (
           id, user_id, tx_id, ref_tx_id, action, amount, delta_used,
           used_before, used_after, cycle_month, note
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          uuidv7(),
          buyerUserId,
          primaryRefundTxId,
          cleanTxId,
          refundAction,
          actualRefundAmount,
          -creditToReduce,
          oldUsed,
          newUsed,
          purchaseEntry.cycle_month,
          refundNote,
        ],
      );

      await recordAudit(client, "POSTPAID_REFUND", {
        original_tx_id: cleanTxId,
        refund_tx_id: primaryRefundTxId,
        excess_tx_id: excessTxId,
        actor_id: actorId,
        buyer_user_id: buyerUserId,
        merchant_id: merchantId,
        refund_amount: actualRefundAmount,
        credited_to_postpaid: creditToReduce,
        credited_to_main_wallet: excessToMainWallet,
        used_before: oldUsed,
        used_after: newUsed,
        billed_after: newBilled,
      });

      await client.query("COMMIT");

      resultPayload = {
        originalTransactionId: cleanTxId,
        refundTransactionId: primaryRefundTxId,
        excessTransactionId: excessTxId,
        buyerUserId,
        merchantId,
        refundAmount: actualRefundAmount,
        creditedToPostpaid: creditToReduce,
        creditedToMainWallet: excessToMainWallet,
        usedAmountAfter: newUsed,
        billedAmountAfter: newBilled,
        postpaidStatus: newStatus,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return resultPayload;
  },

  /**
   * Chốt sao kê theo từng lô (tối đa batchSize dòng mỗi transaction) vào hoặc sau ngày billing_day.
   */
  async closeBillingCycle({ nowMs = Date.now(), batchSize = 500 } = {}) {
    const [{ config, statuses, entryActions }] = await Promise.all([
      postpaidRepository.getSystemCatalog(pool),
      postpaidRepository.verifySystemPostpaidWallet(pool),
    ]);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const statementCloseAction = requireCatalogCode(
      entryActions,
      "STATEMENT_CLOSE",
      ACTION_CATALOG_LABEL,
    );
    const vnMeta = getVnDateMeta(nowMs);
    if (!config.enabled || vnMeta.day < config.billing_day) {
      return { skipped: true, processed: 0, cycleMonth: vnMeta.cycleMonth };
    }

    const dueDateStr = buildDueDateStr(
      vnMeta.nextMonthYear,
      vnMeta.nextMonthNum,
      config.due_day,
    );
    const safeBatch = Math.min(Math.max(1, Number(batchSize) || 500), 1000);
    let totalProcessed = 0;

    while (true) {
      const client = await pool.connect();
      let batchCount = 0;

      try {
        await client.query("BEGIN");

        const batchRes = await client.query(
          `SELECT user_id, used_amount, late_fee_amount
             FROM postpaid_wallets
            WHERE (used_amount - late_fee_amount) > 0
              AND status IN ($3, $4)
              AND (current_cycle_month IS DISTINCT FROM $1)
            ORDER BY user_id ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED`,
          [vnMeta.cycleMonth, safeBatch, activeStatus, pastDueStatus],
        );

        batchCount = batchRes.rows.length;
        if (batchCount === 0) {
          await client.query("ROLLBACK");
          break;
        }

        for (const row of batchRes.rows) {
          const used = Number(row.used_amount);
          const lateFee = Number(row.late_fee_amount);
          // Bắt buộc trừ late_fee_amount khỏi used_amount để billed_amount chỉ giữ phần gốc đã chốt
          const newBilled = Math.max(0, used - lateFee);
          if (newBilled <= 0) continue;

          const stmtInsert = await client.query(
            `INSERT INTO postpaid_entries (
               id, user_id, action, amount, delta_used, used_before, used_after, cycle_month, note
             )
             VALUES ($1, $2, $3, $4, 0, $5, $5, $6, $7)
             ON CONFLICT (user_id, cycle_month) WHERE action = 'STATEMENT_CLOSE'
             DO NOTHING
             RETURNING id`,
            [
              uuidv7(),
              row.user_id,
              statementCloseAction,
              newBilled,
              used,
              vnMeta.cycleMonth,
              `Chốt sao kê kỳ ${formatCycleMonthDisplay(vnMeta.cycleMonth)}`,
            ],
          );

          if (!stmtInsert.rows[0]) continue;

          await client.query(
            `UPDATE postpaid_wallets
                SET billed_amount = $1,
                    current_cycle_month = $2,
                    due_date = $3::date,
                    updated_at = NOW()
              WHERE user_id = $4`,
            [newBilled, vnMeta.cycleMonth, dueDateStr, row.user_id],
          );
          totalProcessed += 1;
        }

        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      if (batchCount < safeBatch) break;
    }

    return {
      skipped: false,
      processed: totalProcessed,
      cycleMonth: vnMeta.cycleMonth,
      dueDate: dueDateStr,
    };
  },

  /**
   * Đánh dấu quá hạn & ghi nhận công nợ phí trễ hạn theo từng lô batchSize dòng.
   */
  async markOverdueAndApplyLateFees({ nowMs = Date.now(), batchSize = 500 } = {}) {
    const [{ config, statuses, entryActions }] = await Promise.all([
      postpaidRepository.getSystemCatalog(pool),
      postpaidRepository.verifySystemPostpaidWallet(pool),
    ]);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const lateFeeAction = requireCatalogCode(
      entryActions,
      "LATE_FEE",
      ACTION_CATALOG_LABEL,
    );
    if (!config.enabled) {
      return { skipped: true, processed: 0 };
    }

    const vnMeta = getVnDateMeta(nowMs);
    const safeBatch = Math.min(Math.max(1, Number(batchSize) || 500), 1000);
    let totalProcessed = 0;

    while (true) {
      const client = await pool.connect();
      let batchCount = 0;

      try {
        await client.query("BEGIN");

        const batchRes = await client.query(
          `SELECT user_id, used_amount, billed_amount, late_fee_amount, current_cycle_month, due_date
             FROM postpaid_wallets
            WHERE status = $3
              AND billed_amount > 0
              AND due_date IS NOT NULL
              AND due_date < $1::date
            ORDER BY user_id ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED`,
          [vnMeta.todayDateStr, safeBatch, activeStatus],
        );

        batchCount = batchRes.rows.length;
        if (batchCount === 0) {
          await client.query("ROLLBACK");
          break;
        }

        for (const row of batchRes.rows) {
          const usedBefore = Number(row.used_amount);
          const billed = Number(row.billed_amount);
          const oldLateFee = Number(row.late_fee_amount);
          const cycleMonth = row.current_cycle_month || vnMeta.cycleMonth;

          const rateFee = Math.round((billed * config.late_fee_bps) / 10000);
          const penalty = Math.max(config.min_late_fee, rateFee);

          if (penalty > 0) {
            const feeInsert = await client.query(
              `INSERT INTO postpaid_entries (
                 id, user_id, action, amount, delta_used, used_before, used_after, cycle_month, note
               )
               VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8)
               ON CONFLICT (user_id, cycle_month) WHERE action = 'LATE_FEE'
               DO NOTHING
               RETURNING id`,
              [
                uuidv7(),
                row.user_id,
                lateFeeAction,
                penalty,
                usedBefore,
                usedBefore + penalty,
                cycleMonth,
                `Phí trễ hạn kỳ ${formatCycleMonthDisplay(cycleMonth)}`,
              ],
            );

            if (feeInsert.rows[0]) {
              await client.query(
                `UPDATE postpaid_wallets
                    SET status = $1,
                        late_fee_amount = $2,
                        used_amount = $3,
                        updated_at = NOW()
                  WHERE user_id = $4`,
                [pastDueStatus, oldLateFee + penalty, usedBefore + penalty, row.user_id],
              );
              totalProcessed += 1;
            }
          } else {
            await client.query(
              `UPDATE postpaid_wallets
                  SET status = $1,
                      updated_at = NOW()
                WHERE user_id = $2`,
              [pastDueStatus, row.user_id],
            );
            totalProcessed += 1;
          }
        }

        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      if (batchCount < safeBatch) break;
    }

    return {
      skipped: false,
      processed: totalProcessed,
      todayDate: vnMeta.todayDateStr,
    };
  },
  formatCycleMonthDisplay,
};

module.exports = postpaidRepository;

