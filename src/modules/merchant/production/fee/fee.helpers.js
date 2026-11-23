// fee.helpers.js: Các hàm định dạng bậc phí, lịch áp dụng và dựng phản hồi trạng thái biểu phí Merchant.
const { httpError } = require("../../../../utils/common/http");
const { formatVnd } = require("../../../../utils/common/amount");
const {
  VN_OFFSET_MS,
  mergeEffectiveFeeConfig,
  getVnMonthMeta,
} = require("../../../fee/feeCalculator");

const FEE_PLANS = ["PER_TRANSACTION"];

const PLAN_NAMES = {
  PER_TRANSACTION: "Thu phí theo từng giao dịch (lũy tiến)",
};

function formatVnDateOnly(dateInput) {
  if (!dateInput) return null;
  const dt = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(dt.getTime())) return null;
  const vn = new Date(dt.getTime() + VN_OFFSET_MS);
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = vn.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function assertActiveMerchantRow(user) {
  if (!user || user.role !== "MERCHANT" || user.status !== "ACTIVE") {
    throw httpError(
      403,
      "Tài khoản merchant đang bị khoá hoặc không khả dụng",
    );
  }
}

function normalizeRequestedPlan(rawPlan, { defaultPlan = null } = {}) {
  if (
    rawPlan === undefined ||
    rawPlan === null ||
    (typeof rawPlan === "string" && !rawPlan.trim())
  ) {
    if (defaultPlan) return defaultPlan;
    throw httpError(400, "Vui lòng chọn hình thức thu phí theo từng giao dịch");
  }
  if (typeof rawPlan !== "string") {
    throw httpError(
      400,
      "Hình thức thu phí không hợp lệ, hệ thống hiện chỉ áp dụng thu phí theo từng giao dịch",
    );
  }
  const normalized = rawPlan.trim().toUpperCase();
  if (!FEE_PLANS.includes(normalized)) {
    throw httpError(
      400,
      "Hình thức thu phí không hợp lệ, hệ thống hiện chỉ áp dụng thu phí theo từng giao dịch",
    );
  }
  return normalized;
}

function buildFormattedTiers(feeConfig) {
  const rawTiers = Array.isArray(feeConfig?.tiers) ? feeConfig.tiers : [];
  if (!rawTiers.length) return [];
  const sorted = [...rawTiers].sort(
    (a, b) => Number(a.from_amount || 0) - Number(b.from_amount || 0),
  );
  return sorted.map((t, idx) => {
    const fromAmount = Number(t.from_amount || 0);
    const toAmount =
      idx + 1 < sorted.length ? Number(sorted[idx + 1].from_amount) : null;
    const rateBps = Number(t.rate_bps || 0);
    const ratePercent = Number((rateBps / 100).toFixed(2));
    const rangeLabel =
      toAmount !== null
        ? fromAmount === 0
          ? `Đến dưới ${formatVnd(toAmount)}`
          : `Từ ${formatVnd(fromAmount)} đến dưới ${formatVnd(toAmount)}`
        : `Từ ${formatVnd(fromAmount)} trở lên`;
    return {
      from_amount: fromAmount,
      to_amount: toAmount,
      rate_bps: rateBps,
      rate_percent: ratePercent,
      label: rangeLabel,
    };
  });
}

function formatPlanList(feeConfig, currentPlan, pendingPlan) {
  const perTx = feeConfig.PER_TRANSACTION;
  const formattedTiers = buildFormattedTiers(feeConfig);
  const percent = Number((perTx.percent_bps / 100).toFixed(2));
  const maxText =
    perTx.max_fee != null
      ? `, tối đa ${formatVnd(perTx.max_fee)}`
      : ", không giới hạn tối đa";
  const thresholdText =
    feeConfig.free_threshold_amount > 0
      ? `, miễn phí GD < ${formatVnd(feeConfig.free_threshold_amount)}`
      : "";

  const tierText =
    formattedTiers.length > 1
      ? `Lũy tiến theo doanh số QR tháng (${formattedTiers
          .map((t) => `${t.rate_percent}%`)
          .join(" → ")})`
      : `${percent}% / giao dịch`;

  return [
    {
      code: "PER_TRANSACTION",
      name: PLAN_NAMES.PER_TRANSACTION,
      percent_bps: perTx.percent_bps,
      rate_bps: perTx.percent_bps,
      percent,
      min_fee: perTx.min_fee,
      max_fee: perTx.max_fee,
      free_threshold_amount: feeConfig.free_threshold_amount,
      transfer_fee_bps: feeConfig.transfer_fee_bps ?? 0,
      transfer_fee_percent: feeConfig.transfer_fee_percent ?? 0,
      transfer_min_fee: feeConfig.transfer_min_fee ?? 0,
      transfer_max_fee: feeConfig.transfer_max_fee ?? null,
      tiers: formattedTiers,
      summary: `${tierText} (tối thiểu ${formatVnd(perTx.min_fee)}${maxText}${thresholdText})`,
      is_current: (currentPlan || "PER_TRANSACTION") === "PER_TRANSACTION",
      is_pending: pendingPlan === "PER_TRANSACTION",
    },
  ];
}

function formatScheduleSummary(scheduleRow, systemConfig) {
  if (!scheduleRow) return null;
  const merged = mergeEffectiveFeeConfig(systemConfig, scheduleRow, "MERCHANT");
  return {
    id: scheduleRow.id,
    effective_from: new Date(scheduleRow.effective_from).toISOString(),
    effective_from_date: formatVnDateOnly(scheduleRow.effective_from),
    rate_bps: merged.rate_bps,
    rate_percent: merged.rate_percent,
    min_fee: merged.min_fee,
    max_fee: merged.max_fee,
    free_threshold_amount: merged.free_threshold_amount,
    transfer_fee_bps: merged.transfer_fee_bps,
    transfer_fee_percent: merged.transfer_fee_percent,
    transfer_min_fee: merged.transfer_min_fee,
    transfer_max_fee: merged.transfer_max_fee,
    withdraw_fee_bps: merged.withdraw_fee_bps,
    withdraw_fee_percent: merged.withdraw_fee_percent,
    withdraw_free_quota_per_month: merged.withdraw_free_quota_per_month,
    tiers: merged.tiers || [],
    reason: scheduleRow.reason || null,
  };
}

function buildStatusResponse({
  merchantUser,
  feeConfig,
  systemConfig = null,
  upcomingSchedule = null,
  withdrawQuota = null,
  monthlyQrGross = 0,
  nowMs = Date.now(),
}) {
  const vnMeta = getVnMonthMeta(nowMs);
  const currentPlan = "PER_TRANSACTION";
  const currentLabel = `Đang áp dụng: ${PLAN_NAMES[currentPlan]}`;
  const walletBalance = Number(merchantUser?.balance ?? 0);

  return {
    current_plan: currentPlan,
    current_plan_name: PLAN_NAMES[currentPlan],
    current_month: vnMeta.currentMonth,
    current_month_end_date: vnMeta.currentMonthEndDate,
    next_month: vnMeta.nextMonth,
    display: {
      current_label: currentLabel,
    },
    wallet_balance: walletBalance,
    effective_fee_config: {
      source: feeConfig.source || "SYSTEM_DEFAULT",
      schedule_id: feeConfig.schedule_id || null,
      effective_from: feeConfig.effective_from || null,
      rate_bps: feeConfig.rate_bps,
      rate_percent: feeConfig.rate_percent,
      min_fee: feeConfig.min_fee,
      max_fee: feeConfig.max_fee,
      max_fee_unbounded: feeConfig.max_fee === null,
      free_threshold_amount: feeConfig.free_threshold_amount,
      transfer_fee_bps: feeConfig.transfer_fee_bps ?? 0,
      transfer_fee_percent: feeConfig.transfer_fee_percent ?? 0,
      transfer_min_fee: feeConfig.transfer_min_fee ?? 0,
      transfer_max_fee: feeConfig.transfer_max_fee ?? null,
      transfer_max_fee_unbounded: (feeConfig.transfer_max_fee ?? null) === null,
      withdraw_fee_bps: feeConfig.withdraw_fee_bps,
      withdraw_fee_percent: feeConfig.withdraw_fee_percent,
      withdraw_free_quota_per_month: feeConfig.withdraw_free_quota_per_month,
      tiers: buildFormattedTiers(feeConfig),
    },
    monthly_qr_gross_amount: Number(monthlyQrGross || 0),
    upcoming_fee_schedule: upcomingSchedule
      ? formatScheduleSummary(upcomingSchedule, systemConfig || feeConfig)
      : null,
    withdraw_quota: withdrawQuota,
    available_plans: formatPlanList(feeConfig, currentPlan, null),
  };
}

module.exports = {
  FEE_PLANS,
  PLAN_NAMES,
  formatVnDateOnly,
  assertActiveMerchantRow,
  normalizeRequestedPlan,
  buildFormattedTiers,
  formatPlanList,
  formatScheduleSummary,
  buildStatusResponse,
};

