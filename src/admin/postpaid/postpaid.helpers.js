// postpaid.helpers.js: Hằng số action audit và các hàm ánh xạ dữ liệu ví trả sau / hồ sơ yêu cầu mở khóa cho Admin.
const postpaidRepository = require("../../modules/postpaid/postpaid.repository");

const AUDIT_ACTIONS = Object.freeze({
  FROZEN: "POSTPAID_WALLET_FROZEN",
  UNFROZEN: "POSTPAID_WALLET_UNFROZEN",
  LIMIT_ADJUSTED: "POSTPAID_LIMIT_ADJUSTED",
  UNLOCK_APPROVED: "POSTPAID_UNLOCK_APPROVED",
  UNLOCK_REJECTED: "POSTPAID_UNLOCK_REJECTED",
});

function mapWalletRow(row, vnToday) {
  const creditLimit = Number(row.credit_limit || 0);
  const usedAmount = Number(row.used_amount || 0);
  const billedAmount = Number(row.billed_amount || 0);
  const serviceFeeAmount = Number(row.service_fee_amount || 0);
  const lateFeeAmount = Number(row.late_fee_amount || 0);
  const unbilledAmount = Math.max(
    0,
    usedAmount - billedAmount - serviceFeeAmount - lateFeeAmount,
  );
  const availableLimit = Math.max(0, creditLimit - usedAmount);
  const effectiveDueDate = postpaidRepository.toYmdStr(
    row.overdue_cycle_due_date || row.due_date,
  );
  const daysOverdue =
    row.status === "PAST_DUE" && effectiveDueDate && effectiveDueDate < vnToday
      ? postpaidRepository.diffDaysYmd(vnToday, effectiveDueDate)
      : 0;

  return {
    user_id: row.user_id,
    full_name: row.full_name || null,
    phone: row.phone || null,
    email: row.email || null,
    user_status: row.user_status || null,
    status: row.status,
    lock_reason: row.lock_reason || null,
    overdue_count: Number(row.overdue_count || 0),
    days_overdue: daysOverdue,
    credit_limit: creditLimit,
    used_amount: usedAmount,
    available_limit: availableLimit,
    billed_amount: billedAmount,
    service_fee_amount: serviceFeeAmount,
    late_fee_amount: lateFeeAmount,
    unbilled_amount: unbilledAmount,
    current_cycle_month: row.current_cycle_month || null,
    due_date: effectiveDueDate,
    overdue_cycle_principal: Number(row.overdue_cycle_principal || 0),
    activated_at: row.activated_at,
    updated_at: row.updated_at,
  };
}

function mapUnlockRequestRow(row) {
  const proofPaths = Array.isArray(row.proof_image_paths)
    ? row.proof_image_paths
    : [];
  return {
    id: row.id,
    user_id: row.user_id,
    full_name: row.full_name || null,
    phone: row.phone || null,
    email: row.email || null,
    wallet_status: row.wallet_status || null,
    wallet_lock_reason: row.wallet_lock_reason || null,
    status: row.status,
    user_note: row.user_note || null,
    proof_count: proofPaths.length,
    proof_indexes: proofPaths.map((_, idx) => idx),
    overdue_count_snapshot: Number(row.overdue_count_snapshot || 0),
    credit_limit_snapshot: Number(row.credit_limit_snapshot || 0),
    current_credit_limit:
      row.current_credit_limit !== undefined &&
      row.current_credit_limit !== null
        ? Number(row.current_credit_limit)
        : null,
    reviewed_by: row.reviewed_by || null,
    reviewer_name: row.reviewer_name || null,
    admin_note: row.admin_note || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  AUDIT_ACTIONS,
  mapWalletRow,
  mapUnlockRequestRow,
};

