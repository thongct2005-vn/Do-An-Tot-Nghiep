// systemConfig.helpers.js: Hằng số, mô phỏng tác động thay đổi POSTPAID_CONFIG và định dạng dữ liệu cấu hình hệ thống.
const { httpError } = require("../../utils/common/http");
const { getVnDateMeta } = require("../../utils/common/dateRange");
const {
  POSTPAID_LATE_FEE_TIERS,
} = require("../../modules/postpaid/postpaidConfig");
const {
  SYSTEM_CONFIG_KEYS,
  normalizeStoredSystemConfig,
} = require("./systemConfig.validators");

const SYSTEM_CONFIG_UPDATED_ACTION = "SYSTEM_CONFIG_UPDATED";
const SAMPLE_OVERDUE_AMOUNT_VND = 1000000;

const POSTPAID_CONFIG_METADATA = Object.freeze({
  label: "Cấu hình Ví trả sau (BNPL)",
  effective_scope:
    "Áp dụng cho lượt mở ví trả sau mới và các lượt chạy job chốt sao kê / tính phí sắp tới theo múi giờ Việt Nam (UTC+7); không hồi tố các sao kê đã chốt.",
});

function extractConfigPayload(rawBody) {
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? rawBody
      : {};
  if (Object.prototype.hasOwnProperty.call(body, "config")) {
    return body.config;
  }
  if (Object.prototype.hasOwnProperty.call(body, "proposed_config")) {
    return body.proposed_config;
  }
  const rest = { ...body };
  delete rest.reason;
  delete rest.dry_run;
  delete rest.key;
  return rest;
}

function buildPostpaidConfigImpact(oldConfig, proposedConfig, stats, vnNow = getVnDateMeta()) {
  const computeTierFee = (bps) =>
    Math.round((SAMPLE_OVERDUE_AMOUNT_VND * Number(bps || 0)) / 10000);

  const tierSimulations = POSTPAID_LATE_FEE_TIERS.map((tierSpec) => {
    const oldBps = oldConfig ? Number(oldConfig[tierSpec.key] || 0) : 0;
    const proposedBps = Number(proposedConfig[tierSpec.key] || 0);
    return {
      tier: tierSpec.tier,
      key: tierSpec.key,
      label: tierSpec.label,
      old_bps: oldBps,
      proposed_bps: proposedBps,
      old_fee: oldConfig ? computeTierFee(oldBps) : 0,
      proposed_fee: computeTierFee(proposedBps),
    };
  });

  const warnings = [];
  if (!proposedConfig.enabled) {
    warnings.push(
      "Ví trả sau sẽ ở trạng thái TẮT (enabled = false): người dùng không thể kích hoạt ví mới hoặc thanh toán bằng Ví trả sau, nhưng vẫn trả nợ bình thường.",
    );
  }
  if (oldConfig && proposedConfig.billing_day !== oldConfig.billing_day) {
    const earliestDay = Math.min(
      oldConfig.billing_day,
      proposedConfig.billing_day,
    );
    if (vnNow.day >= earliestDay) {
      warnings.push(
        `Hôm nay là ngày ${vnNow.day}/${vnNow.month}/${vnNow.year} (giờ VN) và đã qua/đang tại mốc ngày ${earliestDay}. Thay đổi billing_day từ ${oldConfig.billing_day} sang ${proposedConfig.billing_day} chỉ áp dụng cho các lượt chạy job chu kỳ tiếp theo, không hồi tố sao kê đã chốt.`,
      );
    } else {
      warnings.push(
        `billing_day mới (${proposedConfig.billing_day}) sẽ áp dụng cho kỳ chốt sao kê ${vnNow.cycleMonth} nếu chạy từ ngày ${proposedConfig.billing_day} trở đi.`,
      );
    }
  }
  if (proposedConfig.due_day <= proposedConfig.billing_day) {
    warnings.push(
      `due_day (${proposedConfig.due_day}) <= billing_day (${proposedConfig.billing_day}): ngày đến hạn thanh toán được tính vào ngày ${proposedConfig.due_day} của tháng kế tiếp sau kỳ chốt sao kê.`,
    );
  }
  if (proposedConfig.min_account_days === 0) {
    warnings.push(
      "min_account_days = 0 sẽ được runtime kẹp tối thiểu 1 ngày khi xét điều kiện mở Ví trả sau.",
    );
  }

  return {
    simulation: {
      vn_current_date: `${vnNow.year}-${String(vnNow.month).padStart(2, "0")}-${String(vnNow.day).padStart(2, "0")}`,
      vn_cycle_month: vnNow.cycleMonth,
      open_wallets_count: Number(stats.open_wallets_count || 0),
      past_due_wallets_count: Number(stats.past_due_wallets_count || 0),
      total_outstanding_debt: Number(stats.total_outstanding_debt || 0),
      wallets_differing_from_default: Number(
        stats.wallets_differing_from_default || 0,
      ),
      sample_overdue_debt: SAMPLE_OVERDUE_AMOUNT_VND,
      old_sample_late_fee: tierSimulations[0].old_fee,
      proposed_sample_late_fee: tierSimulations[0].proposed_fee,
      tier_simulations: tierSimulations,
    },
    warnings,
  };
}

function formatConfigRow(row) {
  const validKey = SYSTEM_CONFIG_KEYS.POSTPAID_CONFIG;
  return {
    key: validKey,
    label: POSTPAID_CONFIG_METADATA.label,
    effective_scope: POSTPAID_CONFIG_METADATA.effective_scope,
    config: normalizeStoredSystemConfig(validKey, row.value),
    description: row.description || null,
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
    updated_by_name: row.updated_by_name || null,
  };
}

function assertValidPostpaidConfigAdminId(adminId) {
  const clean = String(adminId || "").trim();
  if (!clean) {
    throw httpError(
      401,
      "Không xác định được tài khoản quản trị viên thực hiện thao tác",
    );
  }
  return clean;
}

module.exports = {
  SYSTEM_CONFIG_UPDATED_ACTION,
  SAMPLE_OVERDUE_AMOUNT_VND,
  POSTPAID_CONFIG_METADATA,
  extractConfigPayload,
  buildPostpaidConfigImpact,
  formatConfigRow,
  assertValidPostpaidConfigAdminId,
};
