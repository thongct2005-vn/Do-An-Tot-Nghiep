// auditLogs.helpers.js: Chuẩn hóa route, ánh xạ phân hệ/nhãn tiếng Việt, nhóm hành động và kiểm tra bộ lọc nhật ký Admin.
const { httpError } = require("../../utils/common/http");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];
const ALLOWED_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
const ALLOWED_OUTCOMES = ["SUCCESS", "FAILED", "ABORTED"];
const ALLOWED_CATEGORIES = ["READ", "WRITE", "AUTH"];

const SELF_READ_ROUTE_REGEX = /^(\/sb)?(\/api\/v2)?\/admin\/audit-logs(\/|$)/;

const MODULE_DEFINITIONS = {
  auth: {
    key: "auth",
    label: "Xác thực",
    regex: /^(\/sb)?(\/api\/v2)?\/admin\/auth(\/|$)/,
  },
  dashboard: {
    key: "dashboard",
    label: "Dashboard",
    regex: /^(\/sb)?(\/api\/v2)?\/admin\/dashboard(\/|$)/,
  },
  users: {
    key: "users",
    label: "Người dùng",
    regex: /^(\/sb)?(\/api\/v2)?\/admin\/user(\/|$)/,
  },
  transactions: {
    key: "transactions",
    label: "Giao dịch",
    regex: /^(\/sb)?(\/api\/v2)?\/admin\/transactions(\/|$)/,
  },
  merchants: {
    key: "merchants",
    label: "Merchant",
    regex: /^(\/sb)?(\/api\/v2)?\/admin\/merchants(\/|$)/,
  },
  postpaid: {
    key: "postpaid",
    label: "Ví trả sau",
    regex: /^(\/sb)?(\/api\/v2)?\/admin\/postpaid(\/|$)/,
  },
  system_configs: {
    key: "system_configs",
    label: "Cấu hình hệ thống",
    regex: /^(\/sb)?(\/api\/v2)?\/admin\/system-configs(\/|$)/,
  },
  reports: {
    key: "reports",
    label: "Báo cáo & Thống kê",
    regex: /^(\/sb)?(\/api\/v2)?\/admin\/reports(\/|$)/,
  },
  audit_logs: {
    key: "audit_logs",
    label: "Nhật ký quản trị",
    regex: SELF_READ_ROUTE_REGEX,
  },
};

const MODULE_LIST = Object.values(MODULE_DEFINITIONS);

const CATEGORY_LABELS = {
  READ: "Truy vấn",
  WRITE: "Thay đổi dữ liệu",
  AUTH: "Xác thực",
};

const OUTCOME_LABELS = {
  SUCCESS: "Thành công",
  FAILED: "Thất bại",
  ABORTED: "Hủy giữa chừng",
};

const ROUTE_ACTION_LABELS = {
  // Auth
  "POST /admin/auth/login": "Đăng nhập quản trị",
  "POST /admin/auth/logout": "Đăng xuất quản trị",
  "POST /admin/auth/refresh-token": "Làm mới phiên quản trị",
  "GET /admin/auth/me": "Kiểm tra phiên quản trị",

  // Dashboard
  "GET /admin/dashboard/overview": "Xem tổng quan Dashboard",
  "GET /admin/dashboard/cashflow": "Xem biểu đồ dòng tiền",
  "GET /admin/dashboard/transaction-volume": "Xem lưu lượng giao dịch",

  // Users
  "GET /admin/user/stats": "Xem thống kê người dùng",
  "GET /admin/user/login-stats": "Xem thống kê đăng nhập App",
  "GET /admin/user": "Xem danh sách người dùng",
  "POST /admin/user": "Tạo tài khoản người dùng",
  "GET /admin/user/:id": "Xem chi tiết người dùng",
  "GET /admin/user/:id/kyc/:side": "Xem ảnh định danh KYC người dùng",
  "PATCH /admin/user/:id/status": "Cập nhật trạng thái người dùng",
  "PATCH /admin/user/:id/profile": "Cập nhật hồ sơ người dùng",
  "GET /admin/user/:id/transactions": "Xem giao dịch của người dùng",
  "GET /admin/user/:id/history": "Xem lịch sử thay đổi người dùng",
  "POST /admin/user/:id/operations/p2p": "Chuyển tiền P2P hộ người dùng",
  "POST /admin/user/:id/operations/topup": "Nạp tiền hộ người dùng",
  "POST /admin/user/:id/operations/withdraw": "Rút tiền hộ người dùng",

  // Transactions
  "GET /admin/transactions": "Xem danh sách giao dịch",
  "GET /admin/transactions/export": "Xuất Excel danh sách giao dịch",
  "GET /admin/transactions/:id": "Xem chi tiết giao dịch",
  "GET /admin/transactions/:id/receipt.pdf": "Tải biên nhận giao dịch PDF",
  "POST /admin/transactions/:id/disputes": "Mở hồ sơ tra soát giao dịch",
  "POST /admin/transactions/:id/disputes/:disputeId/events":
    "Cập nhật hồ sơ tra soát giao dịch",
  "POST /admin/transactions/:id/reverse": "Hoàn tiền thanh toán Merchant",

  // Merchants & Fees
  "GET /admin/merchants": "Xem danh sách Merchant",
  "POST /admin/merchants": "Tạo đối tác Merchant",
  "GET /admin/merchants/export": "Xuất Excel danh sách Merchant",
  "GET /admin/merchants/:id": "Xem chi tiết Merchant",
  "PATCH /admin/merchants/:id/status": "Cập nhật trạng thái Merchant",
  "PATCH /admin/merchants/:id/profile": "Cập nhật hồ sơ Merchant",
  "GET /admin/merchants/:id/kyc/:side": "Xem ảnh định danh KYC Merchant",
  "GET /admin/merchants/:id/fee-config": "Xem biểu phí riêng Merchant",
  "GET /admin/merchants/:id/audit-logs": "Xem lịch sử khóa tích hợp Merchant",
  "POST /admin/merchants/:id/credentials": "Cấp khóa tích hợp Merchant",
  "POST /admin/merchants/:id/credentials/rotate": "Đổi khóa tích hợp Merchant",
  "POST /admin/merchants/:id/credentials/revoke": "Thu hồi khóa tích hợp Merchant",
  "POST /admin/merchants/:id/credentials/reissue":
    "Cấp lại khóa tích hợp Merchant",
  "GET /admin/merchants/fee-config/default": "Xem biểu phí mặc định",
  "POST /admin/merchants/fee-config/default/preview":
    "Xem trước thay đổi biểu phí",
  "PUT /admin/merchants/fee-config/default": "Cập nhật biểu phí mặc định",
  "GET /admin/merchants/fee-config/history": "Xem lịch sử cập nhật biểu phí",

  // Postpaid
  "GET /admin/postpaid/overview": "Xem tổng quan Ví trả sau",
  "GET /admin/postpaid/wallets": "Xem danh sách Ví trả sau",
  "GET /admin/postpaid/wallets/:userId": "Xem chi tiết Ví trả sau",
  "POST /admin/postpaid/wallets/:userId/freeze": "Khóa thủ công Ví trả sau",
  "POST /admin/postpaid/wallets/:userId/unfreeze": "Mở khóa thủ công Ví trả sau",
  "POST /admin/postpaid/wallets/:userId/limit-adjust":
    "Điều chỉnh hạn mức Ví trả sau",
  "GET /admin/postpaid/entries": "Xem sổ cái Ví trả sau",
  "GET /admin/postpaid/unlock-requests": "Xem yêu cầu mở khóa Ví trả sau",
  "GET /admin/postpaid/unlock-requests/:id/proof/:index":
    "Xem ảnh chứng minh thu nhập",
  "POST /admin/postpaid/unlock-requests/:id/approve":
    "Duyệt yêu cầu mở khóa Ví trả sau",
  "POST /admin/postpaid/unlock-requests/:id/reject":
    "Từ chối yêu cầu mở khóa Ví trả sau",

  // System Configs
  "GET /admin/system-configs": "Xem danh sách cấu hình hệ thống",
  "GET /admin/system-configs/history": "Xem lịch sử cấu hình hệ thống",
  "GET /admin/system-configs/:key": "Xem chi tiết cấu hình hệ thống",
  "POST /admin/system-configs/:key/preview":
    "Xem trước thay đổi cấu hình hệ thống",
  "PUT /admin/system-configs/:key": "Cập nhật cấu hình hệ thống",

  // Reports
  "GET /admin/reports/overview": "Xem tổng quan báo cáo tài chính",
  "GET /admin/reports/timeseries": "Xem chuỗi thời gian báo cáo",
  "GET /admin/reports/breakdown": "Xem phân bổ báo cáo Merchant",
  "GET /admin/reports/payment-requests": "Xem báo cáo cổng thanh toán",
  "GET /admin/reports/growth": "Xem báo cáo tăng trưởng",
  "GET /admin/reports/logins": "Xem báo cáo đăng nhập App",
  "GET /admin/reports/export": "Xuất Excel báo cáo tài chính",

  // Audit Logs
  "GET /admin/audit-logs/actors": "Xem danh sách Quản trị viên",
  "GET /admin/audit-logs/actions": "Xem danh sách nhật ký truy vấn",
  "GET /admin/audit-logs/actions/summary": "Xem thống kê nhật ký truy vấn",
  "GET /admin/audit-logs/actions/:id": "Xem chi tiết bản ghi nhật ký",
  "GET /admin/audit-logs/changes": "Xem lịch sử thay đổi dữ liệu",
};

const CHANGE_ACTION_GROUPS = {
  USER: [
    "USER_CREATED",
    "USER_PROFILE_UPDATED",
    "USER_BLOCKED",
    "USER_UNBLOCKED",
    "ADMIN_OP_P2P",
    "ADMIN_OP_TOPUP",
    "ADMIN_OP_WITHDRAW",
  ],
  MERCHANT: [
    "MERCHANT_CREATED",
    "MERCHANT_BLOCKED",
    "MERCHANT_UNBLOCKED",
    "MERCHANT_CREDENTIALS_ISSUED",
    "MERCHANT_CREDENTIALS_ROTATED",
    "MERCHANT_CREDENTIALS_REVOKED",
    "MERCHANT_CREDENTIALS_REISSUED",
    "MERCHANT_FEE_CONFIG_UPDATED",
  ],
  TRANSACTION: [
    "ADMIN_OP_REVERSAL",
    "DISPUTE_OPENED",
    "DISPUTE_UPDATED",
    "DISPUTE_RESOLVED",
  ],
  POSTPAID: [
    "POSTPAID_WALLET_FROZEN",
    "POSTPAID_WALLET_UNFROZEN",
    "POSTPAID_LIMIT_ADJUSTED",
    "POSTPAID_UNLOCK_APPROVED",
    "POSTPAID_UNLOCK_REJECTED",
  ],
  CONFIG: ["SYSTEM_CONFIG_UPDATED", "SYSTEM_FEE_CONFIG_UPDATED"],
};

const CHANGE_GROUP_LABELS = {
  USER: "Người dùng",
  MERCHANT: "Merchant",
  TRANSACTION: "Giao dịch & Tra soát",
  POSTPAID: "Ví trả sau",
  CONFIG: "Cấu hình & Biểu phí",
};

const CHANGE_ACTION_LABELS = {
  USER_CREATED: "Tạo tài khoản người dùng",
  USER_PROFILE_UPDATED: "Cập nhật hồ sơ tài khoản",
  USER_BLOCKED: "Khóa tài khoản người dùng",
  USER_UNBLOCKED: "Mở khóa tài khoản người dùng",
  ADMIN_OP_P2P: "Chuyển tiền P2P hộ người dùng",
  ADMIN_OP_TOPUP: "Nạp tiền hộ người dùng",
  ADMIN_OP_WITHDRAW: "Rút tiền hộ người dùng",
  MERCHANT_CREATED: "Tạo đối tác Merchant",
  MERCHANT_BLOCKED: "Khóa tài khoản Merchant",
  MERCHANT_UNBLOCKED: "Mở khóa tài khoản Merchant",
  MERCHANT_CREDENTIALS_ISSUED: "Cấp khóa tích hợp lần đầu",
  MERCHANT_CREDENTIALS_ROTATED: "Đổi khóa tích hợp Merchant",
  MERCHANT_CREDENTIALS_REVOKED: "Thu hồi khóa tích hợp Merchant",
  MERCHANT_CREDENTIALS_REISSUED: "Cấp lại khóa tích hợp sau thu hồi",
  MERCHANT_FEE_CONFIG_UPDATED: "Cập nhật biểu phí riêng Merchant",
  ADMIN_OP_REVERSAL: "Hoàn tiền thanh toán Merchant",
  DISPUTE_OPENED: "Mở hồ sơ tra soát giao dịch",
  DISPUTE_UPDATED: "Cập nhật hồ sơ tra soát",
  DISPUTE_RESOLVED: "Đóng hồ sơ tra soát",
  POSTPAID_WALLET_FROZEN: "Khóa thủ công Ví trả sau",
  POSTPAID_WALLET_UNFROZEN: "Mở khóa thủ công Ví trả sau",
  POSTPAID_LIMIT_ADJUSTED: "Điều chỉnh hạn mức Ví trả sau",
  POSTPAID_UNLOCK_APPROVED: "Duyệt yêu cầu mở khóa Ví trả sau",
  POSTPAID_UNLOCK_REJECTED: "Từ chối yêu cầu mở khóa Ví trả sau",
  SYSTEM_CONFIG_UPDATED: "Cập nhật cấu hình hệ thống",
  SYSTEM_FEE_CONFIG_UPDATED: "Cập nhật biểu phí mặc định",
};

const CONFIG_KEY_LABELS = {
  POSTPAID_CONFIG: "Cấu hình Ví trả sau",
  MERCHANT_FEE_CONFIG: "Biểu phí Merchant mặc định",
  USER_FEE_CONFIG: "Biểu phí người dùng mặc định",
};

function isValidUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAdminRoute(rawRoute) {
  const cleaned = String(rawRoute || "")
    .split("?", 1)[0]
    .trim();
  if (!cleaned) return "/admin/*";
  const withoutPrefix = cleaned.replace(/^(\/sb)?\/api\/v2(?=\/|$)/, "");
  const normalized =
    withoutPrefix.length > 1 ? withoutPrefix.replace(/\/+$/, "") : withoutPrefix;
  return normalized || "/admin/*";
}

function resolveActionModule(route) {
  const value = String(route || "");
  for (const mod of MODULE_LIST) {
    if (mod.regex.test(value)) {
      return { module: mod.key, module_label: mod.label };
    }
  }
  return { module: "other", module_label: "Khác" };
}

function resolveActionCategory(method, route) {
  const upperMethod = String(method || "").toUpperCase();
  if (MODULE_DEFINITIONS.auth.regex.test(String(route || ""))) {
    return { category: "AUTH", category_label: CATEGORY_LABELS.AUTH };
  }
  if (upperMethod === "GET") {
    return { category: "READ", category_label: CATEGORY_LABELS.READ };
  }
  return { category: "WRITE", category_label: CATEGORY_LABELS.WRITE };
}

function resolveActionLabel(method, route) {
  const upperMethod = String(method || "").toUpperCase();
  const normalized = normalizeAdminRoute(route);
  const direct = ROUTE_ACTION_LABELS[`${upperMethod} ${normalized}`];
  if (direct) return direct;

  const { module_label } = resolveActionModule(route);
  if (upperMethod === "GET") return `Tra cứu dữ liệu ${module_label}`;
  if (upperMethod === "POST") return `Thực thi thao tác ${module_label}`;
  if (upperMethod === "PATCH" || upperMethod === "PUT") {
    return `Cập nhật dữ liệu ${module_label}`;
  }
  if (upperMethod === "DELETE") return `Xóa dữ liệu ${module_label}`;
  return `Thao tác ${module_label}`;
}

function resolveChangeActionMeta(action) {
  const code = String(action || "").trim().toUpperCase();
  let group = "OTHER";
  for (const [groupKey, codes] of Object.entries(CHANGE_ACTION_GROUPS)) {
    if (codes.includes(code)) {
      group = groupKey;
      break;
    }
  }
  return {
    action_group: group,
    action_group_label: CHANGE_GROUP_LABELS[group] || "Khác",
    action_label: CHANGE_ACTION_LABELS[code] || (code || "Thao tác quản trị"),
  };
}

function resolveChangeTarget(row) {
  const action = String(row.action || "").trim().toUpperCase();
  const newValues =
    row.new_values && typeof row.new_values === "object" ? row.new_values : null;
  const oldValues =
    row.old_values && typeof row.old_values === "object" ? row.old_values : null;

  if (CHANGE_ACTION_GROUPS.CONFIG.includes(action)) {
    const configKey = newValues?.key || oldValues?.key || null;
    const label =
      (configKey && CONFIG_KEY_LABELS[configKey]) ||
      configKey ||
      "Cấu hình hệ thống";
    return {
      type: "CONFIG",
      id: configKey || row.user_id,
      label,
      sublabel: configKey || "",
    };
  }

  if (CHANGE_ACTION_GROUPS.TRANSACTION.includes(action)) {
    const txId = newValues?.transaction_id || oldValues?.transaction_id || null;
    const userSummary = [row.target_name, row.target_phone]
      .filter(Boolean)
      .join(" • ");
    return {
      type: "TRANSACTION",
      id: txId ? String(txId) : row.user_id,
      label: txId ? `Giao dịch #${txId}` : row.target_name || "Giao dịch",
      sublabel: userSummary,
      user_id: row.user_id,
    };
  }

  const targetType =
    String(row.target_role || "").toUpperCase() === "MERCHANT"
      ? "MERCHANT"
      : "USER";
  return {
    type: targetType,
    id: row.user_id,
    label: row.target_name || "Chưa cập nhật",
    sublabel: row.target_phone || row.target_email || "",
  };
}

function parseExcludeSelfRead(raw) {
  if (raw === undefined || raw === null || raw === "") return true;
  if (typeof raw === "boolean") return raw;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "false" || normalized === "0") return false;
  if (normalized === "true" || normalized === "1") return true;
  throw httpError(400, "Tham số exclude_self_read chỉ chấp nhận true hoặc false");
}

function validateActionFilters(query = {}) {
  const rawAdminId =
    typeof query.admin_id === "string" ? query.admin_id.trim() : "";
  let adminId = null;
  if (rawAdminId) {
    if (rawAdminId.toUpperCase() === "UNAUTHENTICATED") {
      adminId = "UNAUTHENTICATED";
    } else if (isValidUuid(rawAdminId)) {
      adminId = rawAdminId;
    } else {
      throw httpError(400, "Định dạng admin_id không hợp lệ");
    }
  }

  const rawModule =
    typeof query.module === "string" ? query.module.trim().toLowerCase() : "";
  const moduleKey = rawModule && rawModule !== "all" ? rawModule : null;
  if (moduleKey && !MODULE_DEFINITIONS[moduleKey]) {
    throw httpError(400, "Phân hệ lọc không hợp lệ");
  }

  const rawCategory =
    typeof query.category === "string" ? query.category.trim().toUpperCase() : "";
  const category = rawCategory && rawCategory !== "ALL" ? rawCategory : null;
  if (category && !ALLOWED_CATEGORIES.includes(category)) {
    throw httpError(400, "Loại thao tác lọc không hợp lệ");
  }

  const rawMethod =
    typeof query.method === "string" ? query.method.trim().toUpperCase() : "";
  const method = rawMethod && rawMethod !== "ALL" ? rawMethod : null;
  if (method && !ALLOWED_METHODS.includes(method)) {
    throw httpError(400, "Phương thức lọc không hợp lệ");
  }

  const rawOutcome =
    typeof query.outcome === "string" ? query.outcome.trim().toUpperCase() : "";
  const outcome = rawOutcome && rawOutcome !== "ALL" ? rawOutcome : null;
  if (outcome && !ALLOWED_OUTCOMES.includes(outcome)) {
    throw httpError(400, "Trạng thái kết quả lọc không hợp lệ");
  }

  const ip =
    typeof query.ip === "string" ? query.ip.trim().slice(0, 64) : "";
  const search =
    typeof query.search === "string" ? query.search.trim().slice(0, 120) : "";
  const excludeSelfRead = parseExcludeSelfRead(query.exclude_self_read);

  return {
    adminId,
    module: moduleKey,
    category,
    method,
    outcome,
    ip: ip || null,
    search: search || null,
    excludeSelfRead,
  };
}

function validateChangeFilters(query = {}) {
  const rawAdminId =
    typeof query.admin_id === "string" ? query.admin_id.trim() : "";
  let adminId = null;
  if (rawAdminId) {
    if (!isValidUuid(rawAdminId)) {
      throw httpError(400, "Định dạng admin_id không hợp lệ");
    }
    adminId = rawAdminId;
  }

  const rawGroup =
    typeof query.action_group === "string"
      ? query.action_group.trim().toUpperCase()
      : "";
  const actionGroup = rawGroup && rawGroup !== "ALL" ? rawGroup : null;
  if (actionGroup && !CHANGE_ACTION_GROUPS[actionGroup]) {
    throw httpError(400, "Nhóm hành động lọc không hợp lệ");
  }

  const rawAction =
    typeof query.action === "string" ? query.action.trim().toUpperCase() : "";
  const action = rawAction && rawAction !== "ALL" ? rawAction : null;
  if (action && !/^[A-Z0-9_]{2,60}$/.test(action)) {
    throw httpError(400, "Mã hành động lọc không hợp lệ");
  }

  const search =
    typeof query.search === "string" ? query.search.trim().slice(0, 120) : "";

  return {
    adminId,
    actionGroup,
    action,
    search: search || null,
  };
}

module.exports = {
  UUID_REGEX,
  WRITE_METHODS,
  ALLOWED_METHODS,
  ALLOWED_OUTCOMES,
  ALLOWED_CATEGORIES,
  SELF_READ_ROUTE_REGEX,
  MODULE_DEFINITIONS,
  CATEGORY_LABELS,
  OUTCOME_LABELS,
  ROUTE_ACTION_LABELS,
  CHANGE_ACTION_GROUPS,
  CHANGE_GROUP_LABELS,
  CHANGE_ACTION_LABELS,
  CONFIG_KEY_LABELS,
  isValidUuid,
  escapeRegex,
  normalizeAdminRoute,
  resolveActionModule,
  resolveActionCategory,
  resolveActionLabel,
  resolveChangeActionMeta,
  resolveChangeTarget,
  parseExcludeSelfRead,
  validateActionFilters,
  validateChangeFilters,
};
