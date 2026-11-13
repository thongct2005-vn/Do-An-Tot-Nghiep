const adminTransactionRepository = require("./transaction.repository");
const { httpError } = require("../../utils/httpError");
const { uuidv7 } = require("uuidv7");
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
const VALID_ANOMALIES = [
  "ALL",
  "BALANCE_MISMATCH",
  "MISSING_SNAPSHOT",
  "STUCK_PENDING",
  "HIGH_VALUE_TX",
  "ACTIVE_DISPUTE",
];

const VALID_DISPUTE_TYPES = [
  "BALANCE_MISMATCH",
  "MISSING_SNAPSHOT",
  "STUCK_PENDING",
  "CUSTOMER_COMPLAINT",
  "OTHER",
];
const VALID_RESOLUTION_RESULTS = [
  "VALID_TRANSACTION",
  "CONFIRMED_DISCREPANCY",
  "REJECTED",
];

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
  anomaly,
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

  const cleanAnomaly = anomaly ? anomaly.trim().toUpperCase() : "ALL";
  if (!VALID_ANOMALIES.includes(cleanAnomaly)) {
    throw httpError(
      400,
      `Cảnh báo bất thường không hợp lệ. Chỉ chấp nhận: ${VALID_ANOMALIES.join(", ")}`
    );
  }

  const { filterStartDate, filterEndDate } = parseDateRange({
    period,
    startDate: start_date,
    endDate: end_date,
  });

  return {
    cleanType,
    cleanStatus,
    cleanInitiatedBy,
    cleanAnomaly,
    filterStartDate,
    filterEndDate,
  };
}

function calculateIntegrityAndAnomalies(t) {
  const amount = Number(t.amount || 0);
  const fee = Number(t.fee || 0);
  const merchantFee = Number(t.merchant_fee || 0);

  const hasSourceBefore =
    t.source_balance_before !== null && t.source_balance_before !== undefined;
  const hasSourceAfter =
    t.source_balance_after !== null && t.source_balance_after !== undefined;
  const hasDestBefore =
    t.dest_balance_before !== null && t.dest_balance_before !== undefined;
  const hasDestAfter =
    t.dest_balance_after !== null && t.dest_balance_after !== undefined;

  const sourceBefore = hasSourceBefore ? Number(t.source_balance_before) : null;
  const sourceAfter = hasSourceAfter ? Number(t.source_balance_after) : null;
  const destBefore = hasDestBefore ? Number(t.dest_balance_before) : null;
  const destAfter = hasDestAfter ? Number(t.dest_balance_after) : null;

  let overall_status = "OK";
  let source_snapshot_status = "NOT_APPLICABLE";
  let dest_snapshot_status = "NOT_APPLICABLE";
  const anomalies = [];

  const isSuccess = t.status === "SUCCESS";

  if (isSuccess) {
    if (
      t.transaction_type === "TRANSFER" ||
      (t.transaction_type === "PAYMENT" && t.destination_user_id)
    ) {
      const sourcePresent = hasSourceBefore && hasSourceAfter;
      const destPresent = hasDestBefore && hasDestAfter;

      if (!sourcePresent || !destPresent) {
        overall_status = "MISSING_SNAPSHOT";
        source_snapshot_status = sourcePresent ? "VALID" : "MISSING";
        dest_snapshot_status = destPresent ? "VALID" : "MISSING";
        anomalies.push({
          code: "MISSING_SNAPSHOT",
          severity: "WARNING",
          message: "Giao dịch thiếu dữ liệu ảnh chụp số dư (snapshot) bắt buộc",
        });
      } else {
        const sourceExpected = sourceBefore - (amount + fee);
        const sourceMatches = sourceAfter === sourceExpected;
        const destExpected = destBefore + amount - merchantFee;
        const destMatches = destAfter === destExpected;

        source_snapshot_status = sourceMatches ? "VALID" : "INVALID";
        dest_snapshot_status = destMatches ? "VALID" : "INVALID";

        if (sourceMatches && destMatches) {
          overall_status = "OK";
        } else {
          overall_status = "MISMATCH";
          anomalies.push({
            code: "BALANCE_MISMATCH",
            severity: "CRITICAL",
            message:
              "Số dư ví sau biến động không khớp với số tiền giao dịch và phí",
          });
        }
      }
    } else if (t.transaction_type === "PAYMENT") {
      // Thu phí hệ thống từ ví merchant (không có ví đích)
      dest_snapshot_status = "NOT_APPLICABLE";
      const sourcePresent = hasSourceBefore && hasSourceAfter;
      if (!sourcePresent) {
        overall_status = "MISSING_SNAPSHOT";
        source_snapshot_status = "MISSING";
        anomalies.push({
          code: "MISSING_SNAPSHOT",
          severity: "WARNING",
          message: "Giao dịch thu phí thiếu dữ liệu ảnh chụp số dư nguồn",
        });
      } else {
        const sourceExpected = sourceBefore - (amount + fee);
        const sourceMatches = sourceAfter === sourceExpected;
        source_snapshot_status = sourceMatches ? "VALID" : "INVALID";
        if (sourceMatches) {
          overall_status = "OK";
        } else {
          overall_status = "MISMATCH";
          anomalies.push({
            code: "BALANCE_MISMATCH",
            severity: "CRITICAL",
            message:
              "Số dư ví sau biến động không khớp với số tiền giao dịch và phí",
          });
        }
      }
    } else if (t.transaction_type === "TOPUP") {
      dest_snapshot_status = "NOT_APPLICABLE";
      const sourcePresent = hasSourceBefore && hasSourceAfter;

      if (!sourcePresent) {
        overall_status = "MISSING_SNAPSHOT";
        source_snapshot_status = "MISSING";
        anomalies.push({
          code: "MISSING_SNAPSHOT",
          severity: "WARNING",
          message: "Giao dịch nạp tiền thiếu dữ liệu ảnh chụp số dư nguồn",
        });
      } else {
        const sourceExpected = sourceBefore + amount;
        const sourceMatches = sourceAfter === sourceExpected;
        source_snapshot_status = sourceMatches ? "VALID" : "INVALID";

        if (sourceMatches) {
          overall_status = "OK";
        } else {
          overall_status = "MISMATCH";
          anomalies.push({
            code: "BALANCE_MISMATCH",
            severity: "CRITICAL",
            message: "Số dư ví sau nạp tiền không khớp với số tiền giao dịch",
          });
        }
      }
    } else if (t.transaction_type === "WITHDRAW") {
      dest_snapshot_status = "NOT_APPLICABLE";
      const sourcePresent = hasSourceBefore && hasSourceAfter;

      if (!sourcePresent) {
        overall_status = "MISSING_SNAPSHOT";
        source_snapshot_status = "MISSING";
        anomalies.push({
          code: "MISSING_SNAPSHOT",
          severity: "WARNING",
          message: "Giao dịch rút tiền thiếu dữ liệu ảnh chụp số dư nguồn",
        });
      } else {
        const sourceExpected = sourceBefore - (amount + fee);
        const sourceMatches = sourceAfter === sourceExpected;
        source_snapshot_status = sourceMatches ? "VALID" : "INVALID";

        if (sourceMatches) {
          overall_status = "OK";
        } else {
          overall_status = "MISMATCH";
          anomalies.push({
            code: "BALANCE_MISMATCH",
            severity: "CRITICAL",
            message:
              "Số dư ví sau rút tiền không khớp với số tiền giao dịch và phí",
          });
        }
      }
    }
  }

  // Cảnh báo độc lập 1: STUCK_PENDING (WARNING)
  if (t.status === "PENDING" && t.created_at) {
    const txTime = new Date(t.created_at).getTime();
    if (!isNaN(txTime) && txTime < Date.now() - 15 * 60 * 1000) {
      anomalies.push({
        code: "STUCK_PENDING",
        severity: "WARNING",
        message: "Giao dịch ở trạng thái PENDING quá 15 phút chưa hoàn tất",
      });
    }
  }

  // Cảnh báo độc lập 2: HIGH_VALUE_TX (INFO)
  if (amount >= 10000000) {
    anomalies.push({
      code: "HIGH_VALUE_TX",
      severity: "INFO",
      message: "Giao dịch có giá trị lớn (≥ 10.000.000 ₫)",
    });
  }

  return {
    integrity_checks: {
      overall_status,
      source_snapshot_status,
      dest_snapshot_status,
      checked_at: new Date().toISOString(),
    },
    anomalies,
  };
}

const adminTransactionService = {
  async getTransactions({
    page = 1,
    limit = 20,
    type,
    status,
    initiated_by,
    anomaly,
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
      cleanAnomaly,
      filterStartDate,
      filterEndDate,
    } = parseFilterParams({
      type,
      status,
      initiated_by,
      anomaly,
      period,
      start_date,
      end_date,
    });

    const [total, rows] = await Promise.all([
      adminTransactionRepository.countTransactions({
        type: cleanType,
        status: cleanStatus,
        initiatedBy: cleanInitiatedBy,
        anomaly: cleanAnomaly,
        keyword,
        startDate: filterStartDate,
        endDate: filterEndDate,
      }),
      adminTransactionRepository.getTransactions({
        type: cleanType,
        status: cleanStatus,
        initiatedBy: cleanInitiatedBy,
        anomaly: cleanAnomaly,
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
      merchant_fee: Number(t.merchant_fee || 0),
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

    const cleanId = String(id).trim();

    const [t, timeline, disputeEvents] = await Promise.all([
      adminTransactionRepository.getTransactionDetailById(cleanId),
      adminTransactionRepository.getTransactionTimeline(cleanId),
      adminTransactionRepository.getDisputeEventsByTransactionId(cleanId),
    ]);

    if (!t) {
      throw httpError(404, "Không tìm thấy giao dịch");
    }

    const amount = Number(t.amount || 0);
    const fee = Number(t.fee || 0);
    const merchantFee = Number(t.merchant_fee || 0);

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

    // Phân tích integrity_checks và anomalies
    const { integrity_checks, anomalies } = calculateIntegrityAndAnomalies(t);

    // Phân tích hồ sơ tra soát (disputes)
    const disputeStatusMap = {};
    const disputeTypeMap = {};
    for (const ev of disputeEvents) {
      const dId = ev.new_values?.dispute_id || String(ev.id);
      const st =
        ev.new_values?.dispute_status ||
        (ev.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN");
      disputeStatusMap[dId] = st;
      if (!disputeTypeMap[dId] && ev.new_values?.dispute_type) {
        disputeTypeMap[dId] = ev.new_values.dispute_type;
      }
    }

    const activeDisputeEntry = Object.entries(disputeStatusMap).find(
      ([, st]) => st === "OPEN" || st === "INVESTIGATING"
    );

    let currentDisputeStatus = "NONE";
    let activeDisputeId = null;

    if (activeDisputeEntry) {
      activeDisputeId = activeDisputeEntry[0];
      currentDisputeStatus = activeDisputeEntry[1];
      anomalies.push({
        code: "ACTIVE_DISPUTE",
        severity: "INFO",
        message: "Giao dịch đang có hồ sơ tra soát xử lý",
      });
    } else if (disputeEvents.length > 0) {
      const lastEv = disputeEvents[disputeEvents.length - 1];
      currentDisputeStatus =
        lastEv.new_values?.dispute_status ||
        (lastEv.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "NONE");
    }

    const disputeHistory = disputeEvents.map((ev) => ({
      id: String(ev.id),
      dispute_id: ev.new_values?.dispute_id || String(ev.id),
      action: ev.action,
      dispute_status:
        ev.new_values?.dispute_status ||
        (ev.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN"),
      dispute_type:
        ev.new_values?.dispute_type ||
        disputeTypeMap[ev.new_values?.dispute_id] ||
        null,
      resolution_result: ev.new_values?.resolution_result || null,
      authorization_reference: ev.new_values?.authorization_reference || null,
      reason: ev.reason || "",
      note: ev.new_values?.note || ev.reason || "",
      admin: {
        id: String(ev.admin_id),
        full_name: ev.admin_name || "Quản trị viên",
        email: ev.admin_email || "",
      },
      created_at: ev.created_at,
    }));

    const disputeData = {
      current_status: currentDisputeStatus,
      active_dispute_id: activeDisputeId,
      history: disputeHistory,
    };

    const isConsistent = integrity_checks.overall_status === "OK";

    const baseData = {
      id: String(t.id),
      transaction_type: t.transaction_type,
      status: t.status,
      amount,
      fee,
      merchant_fee: merchantFee,
      fee_rate_snapshot: t.fee_rate_snapshot || null,
      net_amount: Number(t.net_amount ?? (amount - merchantFee)),
      description: t.description || "",
      idempotency_key: t.idempotency_key,
      created_at: t.created_at,
      admin_intervention: adminIntervention,
      integrity_checks,
      anomalies,
      dispute: disputeData,
      timeline,
    };

    switch (t.transaction_type) {
      case "TRANSFER": {
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
          merchant: t.destination_user_id
            ? {
                id: String(t.destination_user_id),
                full_name: t.destination_user_name || "Chưa cập nhật",
                phone: t.destination_user_phone || "",
                email: t.destination_user_email || "",
                balance_before: destBefore,
                balance_after: destAfter,
                difference: hasDestSnapshot ? amount - merchantFee : null,
              }
            : null,
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

  async openDispute(
    transactionId,
    { disputeType, reason, authorizationReference, note, currentUser }
  ) {
    if (!transactionId || String(transactionId).trim() === "") {
      throw httpError(400, "Thiếu định danh giao dịch");
    }
    const cleanTxId = String(transactionId).trim();

    const cleanDisputeType = disputeType ? disputeType.trim().toUpperCase() : "";
    if (!VALID_DISPUTE_TYPES.includes(cleanDisputeType)) {
      throw httpError(
        400,
        `Loại tra soát không hợp lệ. Chỉ chấp nhận: ${VALID_DISPUTE_TYPES.join(", ")}`
      );
    }

    if (!reason || !reason.trim()) {
      throw httpError(400, "Lý do mở tra soát không được để trống");
    }

    const adminId = currentUser?.user_id || currentUser?.id;
    if (!adminId) {
      throw httpError(401, "Yêu cầu đăng nhập quản trị viên để thực hiện thao tác");
    }

    const client = await adminTransactionRepository.getClient();
    try {
      await client.query("BEGIN");

      const tx = await adminTransactionRepository.lockTransactionForDispute(
        client,
        cleanTxId
      );
      if (!tx) {
        throw httpError(404, "Không tìm thấy giao dịch");
      }

      const targetUserId = tx.source_user_id || tx.destination_user_id;
      if (!targetUserId) {
        throw httpError(422, "Giao dịch không có tài khoản người dùng liên kết");
      }

      const existingEvents =
        await adminTransactionRepository.getDisputeEventsByTransactionId(
          cleanTxId,
          client
        );
      const disputeStatusMap = {};
      for (const ev of existingEvents) {
        const dId = ev.new_values?.dispute_id || String(ev.id);
        const st =
          ev.new_values?.dispute_status ||
          (ev.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN");
        disputeStatusMap[dId] = st;
      }

      const hasActive = Object.values(disputeStatusMap).some(
        (st) => st === "OPEN" || st === "INVESTIGATING"
      );
      if (hasActive) {
        throw httpError(
          409,
          "Giao dịch đang có hồ sơ tra soát đang hoạt động. Không thể mở thêm hồ sơ mới."
        );
      }

      const disputeId = uuidv7();
      const newValues = {
        transaction_id: cleanTxId,
        dispute_id: disputeId,
        dispute_status: "OPEN",
        dispute_type: cleanDisputeType,
        resolution_result: null,
        authorization_reference: authorizationReference
          ? authorizationReference.trim()
          : null,
        note: note ? note.trim() : reason.trim(),
      };

      const inserted = await adminTransactionRepository.insertDisputeEvent(
        client,
        {
          adminId,
          userId: targetUserId,
          action: "DISPUTE_OPENED",
          reason: reason.trim(),
          newValues,
        }
      );

      await client.query("COMMIT");

      return {
        dispute_id: disputeId,
        dispute_status: "OPEN",
        dispute_type: cleanDisputeType,
        transaction_id: cleanTxId,
        authorization_reference: newValues.authorization_reference,
        created_at: inserted.created_at,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async appendDisputeEvent(
    transactionId,
    disputeId,
    {
      action,
      disputeStatus,
      resolutionResult,
      reason,
      note,
      currentUser,
    }
  ) {
    if (!transactionId || String(transactionId).trim() === "") {
      throw httpError(400, "Thiếu định danh giao dịch");
    }
    if (!disputeId || String(disputeId).trim() === "") {
      throw httpError(400, "Thiếu định danh hồ sơ tra soát");
    }
    const cleanTxId = String(transactionId).trim();
    const cleanDisputeId = String(disputeId).trim();

    const cleanAction = action ? action.trim().toUpperCase() : "";
    if (!["DISPUTE_UPDATED", "DISPUTE_RESOLVED"].includes(cleanAction)) {
      throw httpError(
        400,
        "Hành động không hợp lệ. Chỉ chấp nhận: DISPUTE_UPDATED, DISPUTE_RESOLVED"
      );
    }

    let targetDisputeStatus = "INVESTIGATING";
    let cleanResolutionResult = null;

    if (cleanAction === "DISPUTE_RESOLVED") {
      targetDisputeStatus = "RESOLVED";
      cleanResolutionResult = resolutionResult
        ? resolutionResult.trim().toUpperCase()
        : "";
      if (!VALID_RESOLUTION_RESULTS.includes(cleanResolutionResult)) {
        throw httpError(
          400,
          `Kết quả kết luận không hợp lệ. Chỉ chấp nhận: ${VALID_RESOLUTION_RESULTS.join(", ")}`
        );
      }
    } else {
      if (disputeStatus) {
        const cleanStatus = disputeStatus.trim().toUpperCase();
        if (!["OPEN", "INVESTIGATING"].includes(cleanStatus)) {
          throw httpError(
            400,
            "Trạng thái cập nhật không hợp lệ. Chỉ chấp nhận: OPEN, INVESTIGATING"
          );
        }
        targetDisputeStatus = cleanStatus;
      }
    }

    const finalReason =
      reason && reason.trim()
        ? reason.trim()
        : note && note.trim()
        ? note.trim()
        : "";
    if (!finalReason) {
      throw httpError(400, "Lý do hoặc ghi chú cập nhật không được để trống");
    }

    const adminId = currentUser?.user_id || currentUser?.id;
    if (!adminId) {
      throw httpError(401, "Yêu cầu đăng nhập quản trị viên để thực hiện thao tác");
    }

    const client = await adminTransactionRepository.getClient();
    try {
      await client.query("BEGIN");

      const tx = await adminTransactionRepository.lockTransactionForDispute(
        client,
        cleanTxId
      );
      if (!tx) {
        throw httpError(404, "Không tìm thấy giao dịch");
      }

      const existingEvents =
        await adminTransactionRepository.getDisputeEventsByTransactionId(
          cleanTxId,
          client
        );
      const disputeEvents = existingEvents.filter(
        (ev) => (ev.new_values?.dispute_id || String(ev.id)) === cleanDisputeId
      );
      if (disputeEvents.length === 0) {
        throw httpError(
          404,
          "Không tìm thấy hồ sơ tra soát tương ứng với giao dịch này"
        );
      }

      const latestEv = disputeEvents[disputeEvents.length - 1];
      const currentStatus =
        latestEv.new_values?.dispute_status ||
        (latestEv.action === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN");
      if (currentStatus === "RESOLVED") {
        throw httpError(
          409,
          "Hồ sơ tra soát đã kết thúc (RESOLVED). Không thể cập nhật thêm."
        );
      }

      const initialEv = disputeEvents[0];
      const disputeType = initialEv.new_values?.dispute_type || "OTHER";
      const authorizationReference =
        initialEv.new_values?.authorization_reference || null;

      const targetUserId = tx.source_user_id || tx.destination_user_id;
      const newValues = {
        transaction_id: cleanTxId,
        dispute_id: cleanDisputeId,
        dispute_status: targetDisputeStatus,
        dispute_type: disputeType,
        resolution_result: cleanResolutionResult,
        authorization_reference: authorizationReference,
        note: note ? note.trim() : finalReason,
      };

      const inserted = await adminTransactionRepository.insertDisputeEvent(
        client,
        {
          adminId,
          userId: targetUserId,
          action: cleanAction,
          reason: finalReason,
          oldValues: { dispute_status: currentStatus },
          newValues,
        }
      );

      await client.query("COMMIT");

      return {
        dispute_id: cleanDisputeId,
        action: cleanAction,
        dispute_status: targetDisputeStatus,
        resolution_result: cleanResolutionResult,
        created_at: inserted.created_at,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async exportTransactions({
    type,
    status,
    initiated_by,
    anomaly,
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
      cleanAnomaly,
      filterStartDate,
      filterEndDate,
    } = parseFilterParams({
      type,
      status,
      initiated_by,
      anomaly,
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
      anomaly: cleanAnomaly,
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
    if (cleanAnomaly !== "ALL") summaryParts.push(`Cảnh báo: ${cleanAnomaly}`);
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

