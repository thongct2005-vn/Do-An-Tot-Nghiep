const adminUserRepository = require("./user.repository");
const { httpError } = require("../../utils/httpError");
const { emitToUser } = require("../../utils/socket");

const adminUserService = {
  async getStats() {
    const stats = await adminUserRepository.getUserStats();
    return {
      total_users: Number(stats?.total_count || 0),
      active_users: Number(stats?.active_count || 0),
      suspended_users: Number(stats?.suspended_count || 0),
    };
  },

  async getUsers({ page = 1, limit = 10, search, status }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const { total, items } = await adminUserRepository.getUsers({
      search,
      status,
      limit: limitNum,
      offset,
    });

    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      items: items.map((u) => ({
        id: u.id,
        name: u.full_name || "Chưa cập nhật",
        phone: u.phone,
        email: u.email || "",
        balance: Number(u.balance || 0),
        status: u.status,
        kyc_status: u.kyc_status,
        bank_name: u.default_bank_name || "Chưa liên kết",
        bank_account: u.default_bank_account || "",
        created_at: u.created_at,
      })),
      pagination: {
        total_items: total,
        total_pages: totalPages,
        current_page: pageNum,
        limit: limitNum,
      },
    };
  },

  async getUserDetail(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu định danh người dùng");
    }
    const user = await adminUserRepository.getUserDetail(userId);
    if (!user) {
      throw httpError(404, "Không tìm thấy người dùng");
    }

    return {
      id: user.id,
      name: user.full_name || "Chưa cập nhật",
      phone: user.phone,
      email: user.email || "",
      balance: Number(user.balance || 0),
      status: user.status,
      created_at: user.created_at,
      updated_at: user.updated_at,
      failed_login_attempts: user.failed_login_attempts,
      locked_until: user.locked_until,
      kyc: user.kyc
        ? {
            cccd_number: user.kyc.cccd_number,
            dob: user.kyc.dob,
            gender: user.kyc.gender,
            address: user.kyc.address,
            front_image_url: user.kyc.front_image_url,
            back_image_url: user.kyc.back_image_url,
            face_image_url: user.kyc.face_image_url,
            face_match_score: user.kyc.face_match_score,
            status: user.kyc.status,
          }
        : null,
      linked_banks: (user.linked_banks || []).map((b) => ({
        id: b.id,
        bank_name: b.bank_name,
        bank_code: b.bank_code,
        logo_url: b.logo_url,
        account_number: b.account_number,
        account_holder_name: b.account_holder_name,
        is_default: b.is_default,
        status: b.status,
      })),
    };
  },

  async updateUserStatus({ userId, status, reason }) {
    if (!userId) {
      throw httpError(400, "Thiếu định danh người dùng");
    }
    const validStatuses = ["ACTIVE", "BLOCKED"];
    if (!status || !validStatuses.includes(status)) {
      throw httpError(
        400,
        "Trạng thái không hợp lệ (chỉ chấp nhận ACTIVE hoặc BLOCKED)"
      );
    }

    const updatedUser = await adminUserRepository.updateUserStatus({
      userId,
      status,
    });
    if (!updatedUser) {
      throw httpError(404, "Không tìm thấy người dùng");
    }

    if (status === "BLOCKED") {
      try {
        emitToUser(userId, "force_logout", {
          reason: reason || "Tài khoản của bạn đã bị quản trị viên tạm khóa",
        });
      } catch (e) {
        console.error("Emit force_logout error:", e.message);
      }
    }

    return {
      id: updatedUser.id,
      status: updatedUser.status,
      reason: reason || null,
    };
  },
};

module.exports = adminUserService;
