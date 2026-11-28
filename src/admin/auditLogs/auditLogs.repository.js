// auditLogs.repository.js: Truy vấn MongoDB (admin_action_logs) và PostgreSQL (users, admin_user_change_history) cho Nhật ký quản trị.
const mongoose = require("mongoose");
const pool = require("../../config/database");
const { AdminActionLog } = require("../../models/mongo/adminActionLog.model");
const { httpError } = require("../../utils/common/http");
const {
  WRITE_METHODS,
  SELF_READ_ROUTE_REGEX,
  MODULE_DEFINITIONS,
  CHANGE_ACTION_GROUPS,
  isValidUuid,
  escapeRegex,
} = require("./auditLogs.helpers");

function ensureMongoConnected() {
  if (mongoose.connection.readyState !== 1) {
    throw httpError(503, "Dữ liệu nhật ký truy vấn tạm thời không khả dụng");
  }
}

function buildActionLogsMongoFilter({
  environment,
  startInstant,
  nextDayInstant,
  adminId = null,
  module = null,
  category = null,
  method = null,
  outcome = null,
  ip = null,
  search = null,
  matchedAdminIds = [],
  excludeSelfRead = true,
}) {
  const andClauses = [
    { environment },
    { occurred_at: { $gte: startInstant, $lt: nextDayInstant } },
  ];

  if (adminId === "UNAUTHENTICATED") {
    andClauses.push({ admin_id: null });
  } else if (adminId) {
    andClauses.push({ admin_id: adminId });
  }

  if (module && MODULE_DEFINITIONS[module]) {
    andClauses.push({ route: MODULE_DEFINITIONS[module].regex });
  }

  if (category === "AUTH") {
    andClauses.push({ route: MODULE_DEFINITIONS.auth.regex });
  } else if (category === "READ") {
    andClauses.push({
      method: "GET",
      route: { $not: MODULE_DEFINITIONS.auth.regex },
    });
  } else if (category === "WRITE") {
    andClauses.push({
      method: { $in: WRITE_METHODS },
      route: { $not: MODULE_DEFINITIONS.auth.regex },
    });
  }

  if (method) {
    andClauses.push({ method });
  }

  if (outcome) {
    andClauses.push({ outcome });
  }

  if (ip) {
    andClauses.push({ ip: { $regex: escapeRegex(ip), $options: "i" } });
  }

  if (excludeSelfRead) {
    andClauses.push({
      $nor: [{ method: "GET", route: SELF_READ_ROUTE_REGEX }],
    });
  }

  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    const orClauses = [{ target_id: re }, { route: re }, { ip: re }];
    if (Array.isArray(matchedAdminIds) && matchedAdminIds.length > 0) {
      orClauses.push({ admin_id: { $in: matchedAdminIds } });
    }
    andClauses.push({ $or: orClauses });
  }

  return andClauses.length === 1 ? andClauses[0] : { $and: andClauses };
}

const adminAuditLogsRepository = {
  ensureMongoConnected,
  buildActionLogsMongoFilter,

  async listAdminActors() {
    const { rows } = await pool.query(`
      SELECT id, full_name, email, status
      FROM users
      WHERE role = 'ADMIN'
      ORDER BY full_name ASC NULLS LAST, email ASC
    `);
    return rows;
  },

  async getAdminsByIds(ids) {
    const validIds = Array.from(
      new Set((ids || []).filter((id) => isValidUuid(id))),
    );
    if (validIds.length === 0) return [];
    const { rows } = await pool.query(
      `
      SELECT id, full_name, email
      FROM users
      WHERE id = ANY($1::uuid[])
      `,
      [validIds],
    );
    return rows;
  },

  async findAdminIdsBySearch(keyword) {
    const trimmed = typeof keyword === "string" ? keyword.trim() : "";
    if (!trimmed) return [];
    const pattern = `%${trimmed}%`;
    const { rows } = await pool.query(
      `
      SELECT id
      FROM users
      WHERE role = 'ADMIN'
        AND (COALESCE(full_name, '') ILIKE $1 OR COALESCE(email, '') ILIKE $1)
      `,
      [pattern],
    );
    return rows.map((r) => String(r.id));
  },

  async findActionLogs({ filter, limit, offset }) {
    ensureMongoConnected();
    try {
      const [total, items] = await Promise.all([
        AdminActionLog.countDocuments(filter),
        AdminActionLog.find(filter)
          .sort({ occurred_at: -1, _id: -1 })
          .skip(offset)
          .limit(limit)
          .lean(),
      ]);
      return { total, items };
    } catch (err) {
      if (err?.statusCode) throw err;
      throw httpError(503, "Dữ liệu nhật ký truy vấn tạm thời không khả dụng");
    }
  },

  async getActionLogsSummary(filter) {
    ensureMongoConnected();
    try {
      const rows = await AdminActionLog.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total_requests: { $sum: 1 },
            write_requests: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ["$method", WRITE_METHODS] },
                      {
                        $not: [
                          {
                            $regexMatch: {
                              input: { $ifNull: ["$route", ""] },
                              regex: /^(\/sb)?(\/api\/v2)?\/admin\/auth(\/|$)/,
                            },
                          },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            failed_requests: {
              $sum: {
                $cond: [{ $ne: ["$outcome", "SUCCESS"] }, 1, 0],
              },
            },
            avg_duration_ms: { $avg: "$duration_ms" },
          },
        },
      ]);
      const agg = rows[0];
      return {
        total_requests: Number(agg?.total_requests || 0),
        write_requests: Number(agg?.write_requests || 0),
        failed_requests: Number(agg?.failed_requests || 0),
        avg_duration_ms:
          agg && agg.avg_duration_ms != null
            ? Math.round(Number(agg.avg_duration_ms))
            : 0,
      };
    } catch (err) {
      if (err?.statusCode) throw err;
      throw httpError(503, "Dữ liệu nhật ký truy vấn tạm thời không khả dụng");
    }
  },

  async findActionLogById({ id, environment }) {
    ensureMongoConnected();
    try {
      return await AdminActionLog.findOne({ _id: id, environment }).lean();
    } catch (err) {
      if (err?.statusCode) throw err;
      throw httpError(503, "Dữ liệu nhật ký truy vấn tạm thời không khả dụng");
    }
  },

  async listChangeHistory({
    startInstant,
    nextDayInstant,
    adminId = null,
    actionGroup = null,
    action = null,
    search = null,
    limit = 20,
    offset = 0,
  }) {
    const whereClauses = ["h.created_at >= $1", "h.created_at < $2"];
    const params = [startInstant, nextDayInstant];

    if (adminId) {
      params.push(adminId);
      whereClauses.push(`h.admin_id = $${params.length}::uuid`);
    }

    if (action) {
      params.push(action);
      whereClauses.push(`h.action = $${params.length}`);
    } else if (actionGroup && CHANGE_ACTION_GROUPS[actionGroup]) {
      params.push(CHANGE_ACTION_GROUPS[actionGroup]);
      whereClauses.push(`h.action = ANY($${params.length}::text[])`);
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      whereClauses.push(`(
        COALESCE(h.reason, '') ILIKE $${idx}
        OR COALESCE(h.action, '') ILIKE $${idx}
        OR COALESCE(t.full_name, '') ILIKE $${idx}
        OR COALESCE(t.phone, '') ILIKE $${idx}
        OR COALESCE(t.email, '') ILIKE $${idx}
        OR COALESCE(a.full_name, '') ILIKE $${idx}
        OR COALESCE(a.email, '') ILIKE $${idx}
        OR COALESCE(h.new_values->>'transaction_id', '') ILIKE $${idx}
        OR COALESCE(h.new_values->>'key', '') ILIKE $${idx}
        OR COALESCE(h.old_values->>'key', '') ILIKE $${idx}
      )`);
    }

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const countRes = await pool.query(
      `
      SELECT COUNT(*)::INT AS total
      FROM admin_user_change_history h
      LEFT JOIN users a ON a.id = h.admin_id
      LEFT JOIN users t ON t.id = h.user_id
      ${whereSql}
      `,
      params,
    );
    const total = Number(countRes.rows[0]?.total || 0);

    const dataParams = [...params, limit, offset];
    const limitIdx = dataParams.length - 1;
    const offsetIdx = dataParams.length;

    const { rows } = await pool.query(
      `
      SELECT
        h.id,
        h.admin_id,
        h.user_id,
        h.action,
        h.reason,
        h.old_values,
        h.new_values,
        h.created_at,
        a.full_name AS admin_name,
        a.email AS admin_email,
        t.full_name AS target_name,
        t.phone AS target_phone,
        t.email AS target_email,
        t.role AS target_role
      FROM admin_user_change_history h
      LEFT JOIN users a ON a.id = h.admin_id
      LEFT JOIN users t ON t.id = h.user_id
      ${whereSql}
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      dataParams,
    );

    return { total, items: rows };
  },
};

module.exports = adminAuditLogsRepository;
