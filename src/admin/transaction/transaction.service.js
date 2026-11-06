const adminTransactionRepository = require("./transaction.repository");
const { httpError } = require("../../utils/httpError");
const {
  buildTransactionsAdminXlsx,
  buildExportFileName,
} = require("./transaction.export");

const VALID_TRANSACTION_TYPES = [
  "ALL",
  "TRANSFER",
  "TOPUP",
  "WITHDRAW",
  "PAYMENT",
];
const VALID_TRANSACTION_STATUSES = ["ALL", "SUCCESS", "PENDING", "FAILED"];
const VALID_INITIATED_BY = ["ALL", "USER", "ADMIN", "SYSTEM"];

function parseDateRange({ period, startDate, endDate }) {
  let filterStartDate = null;
  let filterEndDate = null;

  if (startDate && endDate) {
    filterStartDate = new Date(startDate);
    if (isNaN(filterStartDate.getTime())) {
      throw httpError(400, "Ngày bắt đầu không hợp lệ");
    }
    filterStartDate.setHours(0, 0, 0, 0);

    filterEndDate = new Date(endDate);
    if (isNaN(filterEndDate.getTime())) {
      throw httpError(400, "Ngày kết thúc không hợp lệ");
    }
    filterEndDate.setHours(23, 59, 59, 999);

    if (filterStartDate > filterEndDate) {
      throw httpError(400, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
    }
  } else if (period) {
    const now = new Date();
    if (period === "today" || period === "day") {
      filterStartDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0
      );
      filterEndDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
        999
      );
    } else if (period === "week") {
      const day = now.getDay();
      const diffToMonday = now.getDate() - (day === 0 ? 6 : day - 1);
      filterStartDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        diffToMonday,
        0,
        0,
        0
      );
      filterEndDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        diffToMonday + 6,
        23,
        59,
        59,
        999
      );
    } else if (period === "month") {
      filterStartDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      filterEndDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );
    }
  }

  return { filterStartDate, filterEndDate };
}

function parseFilterParams({
  type,
  status,
  initiated_by,
  period,
  start_date,
  end_date,
}) {
  const cleanType = type ? type.trim().toUpperCase() : "ALL";
  if (!VALID_TRANSACTION_TYPES.includes(cleanType)) {
    throw httpError(
      400,
      `Loại giao dịch không hợp lệ. Chỉ chấp nhận: ${VALID_TRANSACTION_TYPES.join(", ")}`
    );
  }

  const cleanStatus = status ? status.trim().toUpperCase() : "ALL";
  if (!VALID_TRANSACTION_STATUSES.includes(cleanStatus)) {
    throw httpError(
      400,
      `Trạng thái giao dịch không hợp lệ. Chỉ chấp nhận: ${VALID_TRANSACTION_STATUSES.join(", ")}`
    );
  }

  const cleanInitiatedBy = initiated_by
    ? initiated_by.trim().toUpperCase()
    : "ALL";
  if (!VALID_INITIATED_BY.includes(cleanInitiatedBy)) {
    throw httpError(
      400,
      `Nguồn thực hiện không hợp lệ. Chỉ chấp nhận: ${VALID_INITIATED_BY.join(", ")}`
    );
  }

  const { filterStartDate, filterEndDate } = parseDateRange({
    period,
    startDate: start_date,
    endDate: end_date,
  });

  return { cleanType, cleanStatus, cleanInitiatedBy, filterStartDate, filterEndDate };
}

const adminTransactionService = {
  async getTransactions({
    page = 1,
    limit = 20,
    type,
    status,
    initiated_by,
    keyword,
    period,
    start_date,
    end_date,
  }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const {
      cleanType,
      cleanStatus,
      cleanInitiatedBy,
      filterStartDate,
      filterEndDate,
    } = parseFilterParams({
      type,
      status,
      initiated_by,
      period,
      start_date,
      end_date,
    });

    const [total, rows] = await Promise.all([
      adminTransactionRepository.countTransactions({
        type: cleanType,
        status: cleanStatus,
        initiatedBy: cleanInitiatedBy,
        keyword,
        startDate: filterStartDate,
        endDate: filterEndDate,
      }),
      adminTransactionRepository.getTransactions({
        type: cleanType,
        status: cleanStatus,
        initiatedBy: cleanInitiatedBy,
        keyword,
        startDate: filterStartDate,
        endDate: filterEndDate,
        limit: limitNum,
        offset,
      }),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    const items = rows.map((t) => ({
      id: String(t.id),
      transaction_type: t.transaction_type,
      amount: Number(t.amount || 0),
      fee: Number(t.fee || 0),
      status: t.status,
      description: t.description || "",
      source_user: t.source_user_id
        ? {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
          }
        : null,
      destination_user: t.destination_user_id
        ? {
            id: String(t.destination_user_id),
            full_name: t.destination_user_name || "Chưa cập nhật",
            phone: t.destination_user_phone || "",
          }
        : null,
      initiated_by: {
        role: t.initiator_role,
        admin_name:
          t.initiator_role === "ADMIN" ? t.admin_name || "Quản trị viên" : null,
        audit_verified: t.initiator_role === "ADMIN",
      },
      created_at: t.created_at,
    }));

    return {
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: totalPages,
      },
    };
  },

  async getTransactionDetail(id) {
    if (!id || String(id).trim() === "") {
      throw httpError(400, "Thiếu định danh giao dịch");
    }

    const t = await adminTransactionRepository.getTransactionDetailById(
      String(id).trim()
    );
    if (!t) {
      throw httpError(404, "Không tìm thấy giao dịch");
    }

    const amount = Number(t.amount || 0);
    const fee = Number(t.fee || 0);

    const hasSourceSnapshot =
      t.source_balance_before !== null &&
      t.source_balance_before !== undefined &&
      t.source_balance_after !== null &&
      t.source_balance_after !== undefined;

    const hasDestSnapshot =
      t.dest_balance_before !== null &&
      t.dest_balance_before !== undefined &&
      t.dest_balance_after !== null &&
      t.dest_balance_after !== undefined;

    const sourceBefore = hasSourceSnapshot
      ? Number(t.source_balance_before)
      : null;
    const sourceAfter = hasSourceSnapshot
      ? Number(t.source_balance_after)
      : null;
    const destBefore = hasDestSnapshot
      ? Number(t.dest_balance_before)
      : null;
    const destAfter = hasDestSnapshot
      ? Number(t.dest_balance_after)
      : null;

    const adminIntervention = t.audit_history_id
      ? {
          is_admin_operation: true,
          action: t.admin_action,
          admin: {
            id: String(t.admin_id),
            full_name: t.admin_name || "Quản trị viên",
            email: t.admin_email || "",
          },
          reason: t.admin_reason,
          authorization_reference: t.admin_auth_ref || null,
          execution_mode: t.admin_execution_mode || null,
          executed_at: t.admin_executed_at,
        }
      : null;

    const baseData = {
      id: String(t.id),
      transaction_type: t.transaction_type,
      status: t.status,
      amount,
      fee,
      description: t.description || "",
      idempotency_key: t.idempotency_key,
      created_at: t.created_at,
      admin_intervention: adminIntervention,
    };

    switch (t.transaction_type) {
      case "TRANSFER": {
        const isConsistent =
          hasSourceSnapshot && hasDestSnapshot
            ? sourceBefore - (amount + fee) === sourceAfter &&
              destBefore + amount === destAfter
            : null;

        return {
          ...baseData,
          is_balance_consistent: isConsistent,
          sender: {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
            email: t.source_user_email || "",
            balance_before: sourceBefore,
            balance_after: sourceAfter,
            difference: hasSourceSnapshot ? -(amount + fee) : null,
          },
          receiver: {
            id: String(t.destination_user_id),
            full_name: t.destination_user_name || "Chưa cập nhật",
            phone: t.destination_user_phone || "",
            email: t.destination_user_email || "",
            balance_before: destBefore,
            balance_after: destAfter,
            difference: hasDestSnapshot ? amount : null,
          },
        };
      }

      case "TOPUP": {
        const isConsistent = hasSourceSnapshot
          ? sourceBefore + amount === sourceAfter
          : null;

        return {
          ...baseData,
          is_balance_consistent: isConsistent,
          user: {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
            email: t.source_user_email || "",
            balance_before: sourceBefore,
            balance_after: sourceAfter,
            difference: hasSourceSnapshot ? amount : null,
          },
          bank: {
            bank_name: t.bank_name || "Chưa cập nhật",
            bank_code: t.bank_code || "",
            account_number: t.bank_account_number || "",
            logo_url: t.bank_logo_url || null,
          },
        };
      }

      case "WITHDRAW": {
        const isConsistent = hasSourceSnapshot
          ? sourceBefore - (amount + fee) === sourceAfter
          : null;

        return {
          ...baseData,
          is_balance_consistent: isConsistent,
          user: {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
            email: t.source_user_email || "",
            balance_before: sourceBefore,
            balance_after: sourceAfter,
            difference: hasSourceSnapshot ? -(amount + fee) : null,
          },
          bank: {
            bank_name: t.bank_name || "Chưa cập nhật",
            bank_code: t.bank_code || "",
            account_number: t.bank_account_number || "",
            logo_url: t.bank_logo_url || null,
          },
        };
      }

      case "PAYMENT": {
        const isConsistent =
          hasSourceSnapshot && hasDestSnapshot
            ? sourceBefore - (amount + fee) === sourceAfter &&
              destBefore + amount === destAfter
            : hasSourceSnapshot
            ? sourceBefore - (amount + fee) === sourceAfter
            : null;

        return {
          ...baseData,
          is_balance_consistent: isConsistent,
          payer: {
            id: String(t.source_user_id),
            full_name: t.source_user_name || "Chưa cập nhật",
            phone: t.source_user_phone || "",
            email: t.source_user_email || "",
            balance_before: sourceBefore,
            balance_after: sourceAfter,
            difference: hasSourceSnapshot ? -(amount + fee) : null,
          },
          merchant: {
            id: String(t.destination_user_id),
            full_name: t.destination_user_name || "Chưa cập nhật",
            phone: t.destination_user_phone || "",
            email: t.destination_user_email || "",
            balance_before: destBefore,
            balance_after: destAfter,
            difference: hasDestSnapshot ? amount : null,
          },
          payment_request: {
            reference_code: t.reference_code || null,
            order_id: t.order_id || null,
          },
        };
      }

      default: {
        return {
          ...baseData,
          is_balance_consistent: null,
          source_user: t.source_user_id
            ? {
                id: String(t.source_user_id),
                full_name: t.source_user_name || "Chưa cập nhật",
                phone: t.source_user_phone || "",
                email: t.source_user_email || "",
                balance_before: sourceBefore,
                balance_after: sourceAfter,
              }
            : null,
          destination_user: t.destination_user_id
            ? {
                id: String(t.destination_user_id),
                full_name: t.destination_user_name || "Chưa cập nhật",
                phone: t.destination_user_phone || "",
                email: t.destination_user_email || "",
                balance_before: destBefore,
                balance_after: destAfter,
              }
            : null,
        };
      }
    }
  },

  async exportTransactions({
    type,
    status,
    initiated_by,
    keyword,
    period,
    start_date,
    end_date,
    currentUser,
  }) {
    const {
      cleanType,
      cleanStatus,
      cleanInitiatedBy,
      filterStartDate,
      filterEndDate,
    } = parseFilterParams({
      type,
      status,
      initiated_by,
      period,
      start_date,
      end_date,
    });

    // Truy xuất an toàn tên Admin xuất báo cáo
    const adminId = currentUser?.user_id || currentUser?.id;
    let adminName = currentUser?.full_name;
    if (!adminName && adminId) {
      const adminUser = await adminTransactionRepository.getUserById(adminId);
      adminName = adminUser?.full_name || "Quản trị viên";
    }
    if (!adminName) {
      adminName = "Quản trị viên";
    }

    // Query tối đa 5001 dòng để kiểm tra trần an toàn (tránh silent truncation)
    const rows = await adminTransactionRepository.getTransactionsForExport({
      type: cleanType,
      status: cleanStatus,
      initiatedBy: cleanInitiatedBy,
      keyword,
      startDate: filterStartDate,
      endDate: filterEndDate,
      limit: 5001,
    });

    if (rows.length > 5000) {
      const err = httpError(
        422,
        "Số lượng giao dịch thỏa mãn vượt quá giới hạn cho phép (5.000 bản ghi). Vui lòng thu hẹp khoảng thời gian hoặc thêm điều kiện lọc."
      );
      err.code = "EXPORT_LIMIT_EXCEEDED";
      throw err;
    }

    if (rows.length === 0) {
      const err = httpError(
        404,
        "Không có dữ liệu giao dịch nào phù hợp với bộ lọc đã chọn."
      );
      err.code = "NO_DATA_FOUND";
      throw err;
    }

    // Tạo tóm tắt bộ lọc cho Header Excel
    const summaryParts = [];
    if (cleanType !== "ALL") summaryParts.push(`Loại: ${cleanType}`);
    if (cleanStatus !== "ALL") summaryParts.push(`Trạng thái: ${cleanStatus}`);
    if (cleanInitiatedBy !== "ALL") summaryParts.push(`Nguồn: ${cleanInitiatedBy}`);
    if (keyword && keyword.trim()) summaryParts.push(`Từ khóa: "${keyword.trim()}"`);
    const filterSummary = summaryParts.join(" | ");

    // Tạo file Excel với module transaction.export.js
    const buffer = await buildTransactionsAdminXlsx({
      rows,
      adminName,
      filterSummary,
      startDate: filterStartDate,
      endDate: filterEndDate,
    });

    const fileName = buildExportFileName(filterStartDate, filterEndDate);

    return { buffer, fileName, totalRows: rows.length };
  },
};

module.exports = adminTransactionService;

