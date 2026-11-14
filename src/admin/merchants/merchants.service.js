const adminMerchantsRepository = require("./merchants.repository");
const { httpError } = require("../../utils/httpError");
const { parseMerchantQuery } = require("./merchants.query");
const { parseProfilePatch } = require("./merchants.profile");
const { parseStatusPatch } = require("./merchants.status");
const socket = require("../../utils/socket");

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

const adminMerchantsService = {
  async updateMerchantStatus({ adminId, merchantId, body }) {
    if (!adminId) throw httpError(401, "Thiếu định danh quản trị viên");
    if (typeof merchantId !== "string" || !UUID_REGEX.test(merchantId.trim())) {
      throw httpError(400, "Định danh đối tác merchant không hợp lệ");
    }
    const id = merchantId.trim().toLowerCase();
    const patch = parseStatusPatch(body);
    const result = await adminMerchantsRepository.updateMerchantStatus({ merchantId: id, adminId, ...patch });
    if (patch.status === "BLOCKED") {
      try {
        await socket.emitToUser(id, "force_logout", {
          reason: "Tài khoản merchant đã bị quản trị viên khóa. Vui lòng liên hệ hỗ trợ.",
        });
      } catch (error) {
        // The database has committed; notification failure must not invite a retry.
        console.error("Không gửi được thông báo khóa merchant");
      }
    }
    return result;
  },

  async updateMerchantProfile({ adminId, merchantId, body }) {
    if (!adminId) throw httpError(401, "Thiếu định danh quản trị viên");
    if (typeof merchantId !== "string" || !UUID_REGEX.test(merchantId.trim())) {
      throw httpError(400, "Định danh đối tác merchant không hợp lệ");
    }
    const id = merchantId.trim().toLowerCase();
    const patch = await parseProfilePatch(body);
    const result = await adminMerchantsRepository.updateMerchantProfile({
      merchantId: id, adminId, ...patch,
    });
    if (result.revokeSession) {
      try {
        socket.emitToUser(id, "force_logout", {
          reason: "Thông tin tài khoản đã được quản trị viên cập nhật. Vui lòng đăng nhập lại.",
        });
      } catch (error) {
        // A delivery failure must not turn a committed update into an API failure.
        console.error("Không gửi được thông báo đăng xuất merchant");
      }
    }
    return {
      merchant: { ...result.merchant, store_name: result.merchant.full_name },
      audit: result.audit,
    };
  },

  async getMerchants(query = {}) {
    const options = parseMerchantQuery(query);
    const { page: pageNum, limit: limitNum } = options;
    const { stats, ...listResult } = await adminMerchantsRepository.getMerchantListSnapshot(options);

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

