const adminTransactionRepository = require("./transaction.repository");
const { httpError } = require("../../utils/httpError");

const VALID_TRANSACTION_TYPES = [
  "ALL",
  "TRANSFER",
  "TOPUP",
  "WITHDRAW",
  "PAYMENT",
];
const VALID_TRANSACTION_STATUSES = ["ALL", "SUCCESS", "PENDING", "FAILED"];
const VALID_INITIATED_BY = ["ALL", "USER", "ADMIN"];

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
    const sourceBefore = Number(t.source_balance_before || 0);
    const sourceAfter = Number(t.source_balance_after || 0);
    const destBefore = Number(t.dest_balance_before || 0);
    const destAfter = Number(t.dest_balance_after || 0);

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
          sourceBefore - (amount + fee) === sourceAfter &&
          destBefore + amount === destAfter;

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
            difference: -(amount + fee),
          },
          receiver: {
            id: String(t.destination_user_id),
            full_name: t.destination_user_name || "Chưa cập nhật",
            phone: t.destination_user_phone || "",
            email: t.destination_user_email || "",
            balance_before: destBefore,
            balance_after: destAfter,
            difference: amount,
          },
        };
      }

      case "TOPUP": {
        const isConsistent = sourceBefore + amount === sourceAfter;

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
            difference: amount,
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
        const isConsistent = sourceBefore - (amount + fee) === sourceAfter;

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
            difference: -(amount + fee),
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
          sourceBefore - (amount + fee) === sourceAfter &&
          destBefore + amount === destAfter;

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
            difference: -(amount + fee),
          },
          merchant: {
            id: String(t.destination_user_id),
            full_name: t.destination_user_name || "Chưa cập nhật",
            phone: t.destination_user_phone || "",
            email: t.destination_user_email || "",
            balance_before: destBefore,
            balance_after: destAfter,
            difference: amount,
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
          is_balance_consistent: true,
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
};

module.exports = adminTransactionService;

