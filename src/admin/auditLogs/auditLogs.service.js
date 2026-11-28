// auditLogs.service.js: Nghiệp vụ tra cứu nhật ký truy vấn API (MongoDB) và lịch sử thay đổi dữ liệu (PostgreSQL) cho Admin.
const mongoose = require("mongoose");
const { httpError } = require("../../utils/common/http");
const { resolveAdminDateRange } = require("../../utils/common/dateRange");
const { parseAdminPagination } = require("../shared/adminHelpers");
const adminAuditLogsRepository = require("./auditLogs.repository");
const {
  OUTCOME_LABELS,
  resolveActionModule,
  resolveActionCategory,
  resolveActionLabel,
  resolveChangeActionMeta,
  resolveChangeTarget,
  validateActionFilters,
  validateChangeFilters,
} = require("./auditLogs.helpers");

function resolveCurrentEnvironment() {
  return process.env.NODE_ENV || "unknown";
}

function buildAdminInfo(adminId, adminMap) {
  if (!adminId) {
    return {
      id: null,
      name: "Chưa xác thực",
      email: "",
    };
  }
  const found = adminMap.get(String(adminId));
  return {
    id: String(adminId),
    name: found?.full_name || "Quản trị viên",
    email: found?.email || "",
  };
}

function mapActionLogDoc(doc, adminMap, { detailed = false } = {}) {
  const { module, module_label } = resolveActionModule(doc.route);
  const { category, category_label } = resolveActionCategory(
    doc.method,
    doc.route,
  );
  const actionLabel = resolveActionLabel(doc.method, doc.route);
  const admin = buildAdminInfo(doc.admin_id, adminMap);

  const base = {
    id: String(doc._id),
    admin,
    admin_id: admin.id,
    admin_name: admin.name,
    admin_email: admin.email,
    module,
    module_label,
    category,
    category_label,
    action_label: actionLabel,
    method: doc.method,
    route: doc.route,
    target_id: doc.target_id ?? null,
    status_code: Number(doc.status_code || 0),
    outcome: doc.outcome,
    outcome_label: OUTCOME_LABELS[doc.outcome] || doc.outcome,
    ip: doc.ip ?? null,
    duration_ms: Number(doc.duration_ms || 0),
    occurred_at: doc.occurred_at,
  };

  if (detailed) {
    return {
      ...base,
      user_agent: doc.user_agent ?? null,
      email_hash: doc.email_hash ?? null,
      environment: doc.environment || resolveCurrentEnvironment(),
    };
  }

  return base;
}

const adminAuditLogsService = {
  async listActors() {
    const rows = await adminAuditLogsRepository.listAdminActors();
    return {
      items: rows.map((u) => ({
        id: String(u.id),
        full_name: u.full_name || "Quản trị viên",
        email: u.email || "",
        status: u.status || "ACTIVE",
      })),
    };
  },

  async _buildResolvedActionFilter(query = {}) {
    adminAuditLogsRepository.ensureMongoConnected();
    const range = resolveAdminDateRange(query.start_date, query.end_date, {
      now: query._now,
    });
    const filters = validateActionFilters(query);
    const matchedAdminIds = filters.search
      ? await adminAuditLogsRepository.findAdminIdsBySearch(filters.search)
      : [];

    const mongoFilter = adminAuditLogsRepository.buildActionLogsMongoFilter({
      environment: resolveCurrentEnvironment(),
      startInstant: range.startInstant,
      nextDayInstant: range.nextDayInstant,
      adminId: filters.adminId,
      module: filters.module,
      category: filters.category,
      method: filters.method,
      outcome: filters.outcome,
      ip: filters.ip,
      search: filters.search,
      matchedAdminIds,
      excludeSelfRead: filters.excludeSelfRead,
    });

    return { range, filters, mongoFilter };
  },

  async getActionsSummary(query = {}) {
    const { range, filters, mongoFilter } =
      await this._buildResolvedActionFilter(query);
    const summary =
      await adminAuditLogsRepository.getActionLogsSummary(mongoFilter);
    return {
      period: range.period,
      exclude_self_read: filters.excludeSelfRead,
      summary,
    };
  },

  async listActions(query = {}) {
    const { pageNum, limitNum, offset } = parseAdminPagination(
      query.page,
      query.limit,
      { defaultLimit: 20, maxLimit: 100 },
    );
    const { range, filters, mongoFilter } =
      await this._buildResolvedActionFilter(query);

    const { total, items } = await adminAuditLogsRepository.findActionLogs({
      filter: mongoFilter,
      limit: limitNum,
      offset,
    });

    const adminIds = items.map((d) => d.admin_id).filter(Boolean);
    const adminRows = await adminAuditLogsRepository.getAdminsByIds(adminIds);
    const adminMap = new Map(adminRows.map((a) => [String(a.id), a]));

    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      period: range.period,
      exclude_self_read: filters.excludeSelfRead,
      items: items.map((doc) => mapActionLogDoc(doc, adminMap)),
      pagination: {
        total_items: total,
        total_pages: totalPages,
        current_page: pageNum,
        limit: limitNum,
      },
    };
  },

  async getActionDetail(id) {
    const rawId = typeof id === "string" ? id.trim() : "";
    if (!mongoose.Types.ObjectId.isValid(rawId)) {
      throw httpError(400, "Mã bản ghi nhật ký không hợp lệ");
    }

    const doc = await adminAuditLogsRepository.findActionLogById({
      id: rawId,
      environment: resolveCurrentEnvironment(),
    });
    if (!doc) {
      throw httpError(404, "Không tìm thấy bản ghi nhật ký");
    }

    const adminRows = doc.admin_id
      ? await adminAuditLogsRepository.getAdminsByIds([doc.admin_id])
      : [];
    const adminMap = new Map(adminRows.map((a) => [String(a.id), a]));

    return mapActionLogDoc(doc, adminMap, { detailed: true });
  },

  async listChanges(query = {}) {
    const range = resolveAdminDateRange(query.start_date, query.end_date, {
      now: query._now,
    });
    const filters = validateChangeFilters(query);
    const { pageNum, limitNum, offset } = parseAdminPagination(
      query.page,
      query.limit,
      { defaultLimit: 20, maxLimit: 100 },
    );

    const { total, items } = await adminAuditLogsRepository.listChangeHistory({
      startInstant: range.startInstant,
      nextDayInstant: range.nextDayInstant,
      adminId: filters.adminId,
      actionGroup: filters.actionGroup,
      action: filters.action,
      search: filters.search,
      limit: limitNum,
      offset,
    });

    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      period: range.period,
      items: items.map((row) => {
        const meta = resolveChangeActionMeta(row.action);
        const target = resolveChangeTarget(row);
        return {
          id: String(row.id),
          action: row.action,
          action_label: meta.action_label,
          action_group: meta.action_group,
          action_group_label: meta.action_group_label,
          reason: row.reason || "",
          old_values: row.old_values ?? null,
          new_values: row.new_values ?? null,
          admin: {
            id: row.admin_id ? String(row.admin_id) : null,
            name: row.admin_name || "Quản trị viên",
            email: row.admin_email || "",
          },
          target,
          created_at: row.created_at,
        };
      }),
      pagination: {
        total_items: total,
        total_pages: totalPages,
        current_page: pageNum,
        limit: limitNum,
      },
    };
  },
};

module.exports = adminAuditLogsService;
