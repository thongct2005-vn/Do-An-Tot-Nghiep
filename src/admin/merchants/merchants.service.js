const adminMerchantsRepository = require("./merchants.repository");
const { httpError } = require("../../utils/httpError");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatMerchantCode(id) {
  const clean = String(id || "").replace(/-/g, "").toUpperCase();
  return `MER-${clean.slice(-5)}`;
}

function formatUserCode(id) {
  const clean = String(id || "").replace(/-/g, "").toUpperCase();
  return `USR-${clean.slice(-5)}`;
}

function getInitials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "MC";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function maskApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  if (apiKey.length <= 12) {
    return `${apiKey.slice(0, 4)}...`;
  }
  return `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`;
}

function resolveDateRange({ period, startDate, endDate }) {
  let start = startDate || null;
  let end = endDate || null;

  if (!start && !end && period && period !== "ALL") {
    const now = new Date();
    const normalized = String(period).toUpperCase();
    if (normalized === "TODAY" || normalized === "DAY") {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start = s.toISOString();
    } else if (normalized === "THIS_WEEK" || normalized === "WEEK") {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const s = new Date(now.getFullYear(), now.getMonth(), diff);
      start = s.toISOString();
    } else if (normalized === "THIS_MONTH" || normalized === "MONTH") {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      start = s.toISOString();
    }
  }

  return { startDate: start, endDate: end };
}

const adminMerchantsService = {
  async getMerchants({
    page = 1,
    limit = 10,
    search,
    tab,
    approval_status,
    status,
    api_status,
    period,
    start_date,
    end_date,
  }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const normalizedTab = tab ? String(tab).trim().toUpperCase() : "ALL";
    const normalizedApproval = approval_status
      ? String(approval_status).trim().toUpperCase()
      : "ALL";
    const normalizedStatus = status
      ? String(status).trim().toUpperCase()
      : "ALL";
    const normalizedApiStatus = api_status
      ? String(api_status).trim().toUpperCase()
      : "ALL";

    const { startDate, endDate } = resolveDateRange({
      period,
      startDate: start_date,
      endDate: end_date,
    });

    const [stats, listResult] = await Promise.all([
      adminMerchantsRepository.getMerchantStats(),
      adminMerchantsRepository.getMerchants({
        search,
        tab: normalizedTab,
        approvalStatus: normalizedApproval,
        status: normalizedStatus,
        apiStatus: normalizedApiStatus,
        startDate,
        endDate,
        limit: limitNum,
        offset,
      }),
    ]);

    const items = listResult.items.map((item) => ({
      id: item.id,
      merchant_code: formatMerchantCode(item.id),
      store_name: item.full_name,
      owner_name: item.owner_name || item.full_name,
      initials: getInitials(item.full_name),
      tax_code: item.tax_code || null,
      phone: item.phone,
      email: item.email || null,
      address: item.address || null,
      balance: String(item.balance ?? "0"),
      approval_status: item.approval_status,
      operational_status: item.operational_status,
      api_status: item.api_status,
      raw_user_status: item.raw_user_status,
      has_api_key: Boolean(item.has_api_key),
      has_secret_key: Boolean(item.has_secret_key),
      has_callback_url: Boolean(
        item.call_back_url && String(item.call_back_url).trim() !== ""
      ),
      call_back_url: item.call_back_url || null,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));

    return {
      stats,
      items,
      pagination: {
        total_items: listResult.total,
        total_pages: Math.ceil(listResult.total / limitNum),
        current_page: pageNum,
        limit: limitNum,
      },
    };
  },

  async getMerchantDetail(merchantId) {
    if (!merchantId || !UUID_REGEX.test(String(merchantId).trim())) {
      throw httpError(400, "Định danh đối tác merchant không hợp lệ");
    }

    const merchant = await adminMerchantsRepository.getMerchantDetail(
      String(merchantId).trim()
    );
    if (!merchant) {
      throw httpError(404, "Không tìm thấy đối tác merchant");
    }

    const totalRequests = Number(merchant.api_stats?.total_requests || 0);
    const successRequests = Number(merchant.api_stats?.success_requests || 0);
    const successRate =
      totalRequests > 0
        ? Number(((successRequests / totalRequests) * 100).toFixed(1))
        : null;

    const currentMonthVolume = Number(
      merchant.volume_stats?.current_month_volume || 0
    );
    const previousMonthVolume = Number(
      merchant.volume_stats?.previous_month_volume || 0
    );
    let momGrowthPercent = 0;
    if (previousMonthVolume > 0) {
      momGrowthPercent = Number(
        (
          ((currentMonthVolume - previousMonthVolume) / previousMonthVolume) *
          100
        ).toFixed(1)
      );
    } else if (currentMonthVolume > 0) {
      momGrowthPercent = 100;
    }

    const primaryBank =
      merchant.linked_banks && merchant.linked_banks.length > 0
        ? merchant.linked_banks[0]
        : null;

    return {
      id: merchant.id,
      merchant_code: formatMerchantCode(merchant.id),
      store_name: merchant.full_name,
      initials: getInitials(merchant.full_name),
      tax_code: merchant.tax_code || null,
      business_type: "Doanh nghiệp / Hộ kinh doanh",
      phone: merchant.phone,
      email: merchant.email || null,
      address: merchant.address || null,
      balance: String(merchant.balance ?? "0"),
      approval_status: merchant.approval_status,
      operational_status: merchant.operational_status,
      api_status: merchant.api_status,
      raw_user_status: merchant.raw_user_status,
      totp_enabled: Boolean(merchant.totp_enabled),
      created_at: merchant.created_at,
      updated_at: merchant.updated_at,
      kyc_documents: {
        front_image_url: merchant.front_image_url || null,
        back_image_url: merchant.back_image_url || null,
        face_image_url: merchant.face_image_url || null,
        face_match_score: merchant.face_match_score ?? null,
      },
      owner: {
        user_id: merchant.id,
        user_code: formatUserCode(merchant.id),
        full_name: primaryBank?.account_holder_name || merchant.full_name,
        phone: merchant.phone,
        email: merchant.email || null,
        status: merchant.raw_user_status,
        kyc_verified: merchant.approval_status === "APPROVED",
        dob: merchant.dob || null,
        gender: merchant.gender || null,
        address: merchant.address || null,
        linked_banks: merchant.linked_banks || [],
      },
      review_decision: {
        approval_status: merchant.approval_status,
        operational_status: merchant.operational_status,
        reviewed_by: merchant.latest_decision
          ? {
              id: merchant.latest_decision.admin_id,
              full_name: merchant.latest_decision.admin_name,
              email: merchant.latest_decision.admin_email,
              role: merchant.latest_decision.admin_role,
            }
          : null,
        reviewed_at:
          merchant.latest_decision?.created_at ||
          merchant.kyc_updated_at ||
          merchant.updated_at ||
          merchant.created_at,
        action: merchant.latest_decision?.action || null,
        reason: merchant.latest_decision?.reason || null,
      },
      integration: {
        api_status: merchant.api_status,
        has_api_key: Boolean(merchant.api_key),
        has_secret_key: Boolean(merchant.has_secret_key),
        api_key: merchant.api_key || null,
        api_key_masked: maskApiKey(merchant.api_key),
        call_back_url: merchant.call_back_url || null,
        webhook_configured: Boolean(
          merchant.call_back_url && String(merchant.call_back_url).trim() !== ""
        ),
        total_requests: totalRequests,
        success_requests: successRequests,
        success_rate: successRate,
        last_api_call_at: merchant.api_stats?.last_api_call_at || null,
        last_payment_reference:
          merchant.api_stats?.last_payment_reference || null,
        last_transaction_id: merchant.api_stats?.last_transaction_id || null,
        last_webhook_status: merchant.api_stats?.last_webhook_status || null,
      },
      metrics: {
        current_month_volume: String(currentMonthVolume),
        previous_month_volume: String(previousMonthVolume),
        mom_growth_percent: momGrowthPercent,
      },
    };
  },
};

module.exports = adminMerchantsService;

