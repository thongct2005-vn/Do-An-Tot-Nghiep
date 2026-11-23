// merchantFee.helpers.js: Hằng số, kiểm tra hợp lệ, mô phỏng biểu phí và gộp cấu hình phí hệ thống Admin.
const { httpError } = require("../../utils/common/http");
const { formatVnd } = require("../../utils/common/amount");
const {
  normalizeSystemFeeConfig,
  previewFeeCalculation,
} = require("../../modules/fee/feeCalculator");

const DEFAULT_SAMPLE_AMOUNTS = [10_000, 50_000, 100_000, 1_000_000, 10_000_000];
const ALLOWED_FEE_AUDIT_ACTIONS = [
  "MERCHANT_FEE_CONFIG_UPDATED",
  "SYSTEM_FEE_CONFIG_UPDATED",
];
const ALLOWED_FEE_CONFIG_KEYS = ["MERCHANT_FEE_CONFIG", "USER_FEE_CONFIG"];

function normalizeRoleParam(rawRole) {
  const role = String(rawRole || "MERCHANT").trim().toUpperCase();
  if (!["MERCHANT", "USER"].includes(role)) {
    throw httpError(
      400,
      "Đối tượng áp dụng biểu phí không hợp lệ, chỉ hỗ trợ tài khoản đối tác hoặc người dùng",
    );
  }
  return role;
}

function parseSampleAmounts(rawSamples) {
  if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
    return DEFAULT_SAMPLE_AMOUNTS;
  }
  const parsed = rawSamples
    .map((n) => Number(n))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
  if (parsed.length === 0) {
    throw httpError(400, "Danh sách mức tiền mẫu không hợp lệ");
  }
  return parsed.slice(0, 20);
}

function simulateFeeSamples({
  oldConfig,
  newConfig,
  role = "MERCHANT",
  alreadyWithdrawn = 0,
  sampleAmounts = DEFAULT_SAMPLE_AMOUNTS,
}) {
  return sampleAmounts.map((amount) => {
    const oldQr = previewFeeCalculation({
      transactionType: "PAYMENT",
      role,
      amount,
      effectiveConfig: oldConfig,
    });
    const newQr = previewFeeCalculation({
      transactionType: "PAYMENT",
      role,
      amount,
      effectiveConfig: newConfig,
    });
    const oldWithdraw = previewFeeCalculation({
      transactionType: "WITHDRAW",
      role,
      amount,
      effectiveConfig: oldConfig,
      alreadyWithdrawn,
    });
    const newWithdraw = previewFeeCalculation({
      transactionType: "WITHDRAW",
      role,
      amount,
      effectiveConfig: newConfig,
      alreadyWithdrawn,
    });
    const oldTransfer = previewFeeCalculation({
      transactionType: "TRANSFER",
      role,
      amount,
      effectiveConfig: oldConfig,
    });
    const newTransfer = previewFeeCalculation({
      transactionType: "TRANSFER",
      role,
      amount,
      effectiveConfig: newConfig,
    });

    return {
      amount,
      qr_payment: {
        old_fee: oldQr.fee_amount,
        new_fee: newQr.fee_amount,
        old_net: oldQr.net_amount,
        new_net: newQr.net_amount,
      },
      transfer_outbound: {
        old_fee: oldTransfer.fee_amount,
        new_fee: newTransfer.fee_amount,
        old_total_debit: oldTransfer.total_debit_from_payer,
        new_total_debit: newTransfer.total_debit_from_payer,
      },
      withdraw: {
        old_fee: oldWithdraw.fee_amount,
        new_fee: newWithdraw.fee_amount,
        old_total_debit: oldWithdraw.total_debit_from_payer,
        new_total_debit: newWithdraw.total_debit_from_payer,
      },
    };
  });
}

function buildPersistableSystemConfig(merged) {
  return {
    rate_bps: merged.rate_bps,
    min_fee: merged.min_fee,
    max_fee: merged.max_fee,
    free_threshold_amount: merged.free_threshold_amount,
    transfer_fee_bps: merged.transfer_fee_bps ?? 0,
    transfer_min_fee: merged.transfer_min_fee ?? 0,
    transfer_max_fee: merged.transfer_max_fee ?? null,
    withdraw_fee_bps: merged.withdraw_fee_bps,
    withdraw_free_quota_per_month: merged.withdraw_free_quota_per_month,
    tiers: Array.isArray(merged.tiers) ? merged.tiers : [],
  };
}

function mergeSystemUpdate(currentRaw, validated, role) {
  const current = normalizeSystemFeeConfig(currentRaw, role);
  const next = {
    rate_bps:
      validated.rate_bps !== undefined ? validated.rate_bps : current.rate_bps,
    min_fee:
      validated.min_fee !== undefined ? validated.min_fee : current.min_fee,
    max_fee:
      validated.max_fee_unbounded === true
        ? null
        : validated.max_fee !== undefined
          ? validated.max_fee
          : current.max_fee,
    free_threshold_amount:
      validated.free_threshold_amount !== undefined
        ? validated.free_threshold_amount
        : current.free_threshold_amount,
    transfer_fee_bps:
      validated.transfer_fee_bps !== undefined
        ? validated.transfer_fee_bps
        : current.transfer_fee_bps,
    transfer_min_fee:
      validated.transfer_min_fee !== undefined
        ? validated.transfer_min_fee
        : current.transfer_min_fee,
    transfer_max_fee:
      validated.transfer_max_fee_unbounded === true
        ? null
        : validated.transfer_max_fee !== undefined
          ? validated.transfer_max_fee
          : current.transfer_max_fee,
    withdraw_fee_bps:
      validated.withdraw_fee_bps !== undefined
        ? validated.withdraw_fee_bps
        : current.withdraw_fee_bps,
    withdraw_free_quota_per_month:
      validated.withdraw_free_quota_per_month !== undefined
        ? validated.withdraw_free_quota_per_month
        : current.withdraw_free_quota_per_month,
    tiers: validated.tiers !== undefined ? validated.tiers : current.tiers,
  };

  if (next.max_fee !== null && next.min_fee > next.max_fee) {
    throw httpError(
      400,
      `Phí giao dịch tối thiểu (${formatVnd(next.min_fee)}) không được lớn hơn phí giao dịch tối đa (${formatVnd(next.max_fee)})`,
    );
  }
  if (
    next.transfer_max_fee !== null &&
    next.transfer_min_fee > next.transfer_max_fee
  ) {
    throw httpError(
      400,
      `Phí chuyển tiền tối thiểu (${formatVnd(next.transfer_min_fee)}) không được lớn hơn phí chuyển tiền tối đa (${formatVnd(next.transfer_max_fee)})`,
    );
  }
  return buildPersistableSystemConfig(next);
}

module.exports = {
  DEFAULT_SAMPLE_AMOUNTS,
  ALLOWED_FEE_AUDIT_ACTIONS,
  ALLOWED_FEE_CONFIG_KEYS,
  normalizeRoleParam,
  parseSampleAmounts,
  simulateFeeSamples,
  buildPersistableSystemConfig,
  mergeSystemUpdate,
};

