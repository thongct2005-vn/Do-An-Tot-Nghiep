const crypto = require("crypto");
const bcrypt = require("bcrypt");
const adminUserRepository = require("./user.repository");
const { httpError } = require("../../utils/httpError");
const { emitToUser } = require("../../utils/socket");
const { isValidPhone, isValidEmail } = require("../../utils/validators");
const { maskPhone } = require("../../utils/maskPhoneAndEmail");

const MAX_ADMIN_AUTH_ATTEMPTS = 5;
const ADMIN_LOCK_MINUTES = 30;
const AUTH_REFERENCE_REGEX = /^[A-Za-z0-9_-]{5,100}$/;
const ADMIN_P2P_REQUEST_PATH = "POST /api/v2/admin/user/:id/operations/p2p";
const MIN_P2P_AMOUNT = 1000;
const MAX_P2P_AMOUNT = 50000000;

function sanitizeP2PResponseData(raw) {
  if (!raw) return raw;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : { ...raw };
  delete parsed.destBalanceAfter;
  delete parsed.dest_balance_after;
  delete parsed.destBalanceBefore;
  delete parsed.dest_balance_before;
  if (parsed.destination_phone && !parsed.destination_phone_masked) {
    parsed.destination_phone_masked = maskPhone(parsed.destination_phone);
  }
  delete parsed.destination_phone;
  delete parsed.destinationPhone;
  return parsed;
}

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
      daily_limit: MAX_P2P_AMOUNT,
      daily_used: Number(user.daily_used || 0),
      status: user.status,
      created_at: user.created_at,
      updated_at: user.updated_at,
      failed_login_attempts: user.failed_login_attempts,
      locked_until: user.locked_until,
      kyc_status: user.kyc ? user.kyc.status : "UNVERIFIED",
      bank_name:
        user.linked_banks && user.linked_banks.length > 0
          ? user.linked_banks[0].bank_name
          : "Chưa liên kết",
      bank_account:
        user.linked_banks && user.linked_banks.length > 0
          ? user.linked_banks[0].account_number
          : "",
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

  async updateUserStatus({ adminId, userId, status, reason }) {
    if (!adminId) {
      throw httpError(401, "Thiếu định danh quản trị viên");
    }
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
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw httpError(400, "Lý do thay đổi trạng thái là bắt buộc");
    }

    const existingUser = await adminUserRepository.getUserDetail(userId);
    if (!existingUser) {
      throw httpError(404, "Không tìm thấy người dùng");
    }

    if (existingUser.status === status) {
      throw httpError(400, `Người dùng hiện đã ở trạng thái ${status}`);
    }

    const updatedUser = await adminUserRepository.updateUserStatusWithHistory({
      userId,
      status,
      adminId,
      reason: reason.trim(),
      oldValues: { status: existingUser.status },
      newValues: { status },
    });
    if (!updatedUser) {
      throw httpError(404, "Không tìm thấy người dùng");
    }

    if (status === "BLOCKED") {
      try {
        emitToUser(userId, "force_logout", {
          reason: reason.trim(),
        });
      } catch (e) {
        console.error("Emit force_logout error:", e.message);
      }
    }

    return {
      id: updatedUser.id,
      status: updatedUser.status,
      reason: reason.trim(),
    };
  },

  async getUserTransactions({
    userId,
    page = 1,
    limit = 10,
    period,
    startDate,
    endDate,
    keyword,
  }) {
    if (!userId) {
      throw httpError(400, "Thiếu định danh người dùng");
    }

    const user = await adminUserRepository.getUserDetail(userId);
    if (!user) {
      throw httpError(404, "Không tìm thấy người dùng");
    }

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
      if (period === "day") {
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

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const { total, items } = await adminUserRepository.getUserTransactions({
      userId,
      startDate: filterStartDate,
      endDate: filterEndDate,
      keyword: keyword && keyword.trim() ? keyword.trim() : null,
      limit: limitNum,
      offset,
    });

    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      filter: {
        period: period || null,
        start_date: filterStartDate,
        end_date: filterEndDate,
      },
      items: items.map((t) => {
        const isOut = t.source_user_id === userId && t.transaction_type !== "TOPUP";
        return {
          id: t.id,
          type: t.transaction_type,
          direction: isOut ? "OUT" : "IN",
          amount: Number(t.amount || 0),
          fee: Number(t.fee || 0),
          status: t.status,
          description: t.description,
          counterparty_name: isOut
            ? t.dest_name || t.bank_name || "Hệ thống"
            : t.source_name || t.bank_name || "Hệ thống",
          counterparty_phone: isOut ? t.dest_phone || "" : t.source_phone || "",
          bank_name: t.bank_name || null,
          bank_account: t.bank_account || null,
          order_id: t.order_id || null,
          balance_before: Number(
            isOut ? t.source_balance_before : t.dest_balance_before || 0
          ),
          balance_after: Number(
            isOut ? t.source_balance_after : t.dest_balance_after || 0
          ),
          created_at: t.created_at,
        };
      }),
      pagination: {
        total_items: total,
        total_pages: totalPages,
        current_page: pageNum,
        limit: limitNum,
      },
    };
  },

  async updateUserProfile({ adminId, userId, fullName, phone, email, reason }) {
    if (!adminId) {
      throw httpError(401, "Thiếu định danh quản trị viên");
    }
    if (!userId) {
      throw httpError(400, "Thiếu định danh người dùng");
    }

    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw httpError(400, "Lý do chỉnh sửa là bắt buộc");
    }

    const existingUser = await adminUserRepository.getUserDetail(userId);
    if (!existingUser) {
      throw httpError(404, "Không tìm thấy người dùng");
    }

    let hasChange = false;
    let revokeSession = false;
    let targetFullName;
    let targetPhone;
    let targetPhoneHash;
    let targetEmail;

    const currentFullName =
      existingUser.full_name !== undefined
        ? existingUser.full_name
        : existingUser.name;
    const normalizedCurrentName =
      currentFullName === "Chưa cập nhật" || !currentFullName
        ? ""
        : currentFullName;

    if (fullName !== undefined) {
      const cleanName = fullName ? fullName.trim() : "";
      if (cleanName.length < 2 || cleanName.length > 50) {
        throw httpError(400, "Họ tên phải từ 2 đến 50 ký tự");
      }
      if (cleanName !== normalizedCurrentName) {
        targetFullName = cleanName;
        hasChange = true;
      }
    }

    if (phone !== undefined) {
      const cleanPhone = phone ? phone.trim() : "";
      if (!isValidPhone(cleanPhone)) {
        throw httpError(
          400,
          "Số điện thoại không hợp lệ (yêu cầu 10 số đầu 03, 05, 07, 08, 09)"
        );
      }
      if (cleanPhone !== existingUser.phone) {
        const isConflict = await adminUserRepository.checkPhoneConflict(
          userId,
          cleanPhone
        );
        if (isConflict) {
          throw httpError(
            409,
            "Số điện thoại đã được đăng ký bởi tài khoản khác"
          );
        }
        targetPhone = cleanPhone;
        targetPhoneHash = crypto
          .createHash("sha256")
          .update(cleanPhone)
          .digest("hex");
        hasChange = true;
        revokeSession = true;
      }
    }

    if (email !== undefined) {
      const cleanEmail = email ? email.trim().toLowerCase() : "";
      if (cleanEmail !== "" && !isValidEmail(cleanEmail)) {
        throw httpError(400, "Địa chỉ email không đúng định dạng");
      }
      if (cleanEmail !== (existingUser.email || "").toLowerCase()) {
        if (cleanEmail !== "") {
          const isConflict = await adminUserRepository.checkEmailConflict(
            userId,
            cleanEmail
          );
          if (isConflict) {
            throw httpError(
              409,
              "Địa chỉ email đã được liên kết với tài khoản khác"
            );
          }
        }
        targetEmail = cleanEmail;
        hasChange = true;
        revokeSession = true;
      }
    }

    if (!hasChange) {
      throw httpError(400, "Không có thông tin nào thay đổi so với hiện tại");
    }

    const oldValues = {
      full_name: normalizedCurrentName || null,
      phone: existingUser.phone,
      email: existingUser.email || null,
    };

    const newValues = {
      full_name:
        targetFullName !== undefined
          ? targetFullName
          : normalizedCurrentName || null,
      phone: targetPhone !== undefined ? targetPhone : existingUser.phone,
      email:
        targetEmail !== undefined ? targetEmail : existingUser.email || null,
    };

    const updatedUser = await adminUserRepository.updateUserProfileWithHistory({
      userId,
      fullName: targetFullName,
      phone: targetPhone,
      phoneHash: targetPhoneHash,
      email: targetEmail,
      revokeSession,
      adminId,
      reason: reason.trim(),
      oldValues,
      newValues,
    });

    if (revokeSession) {
      try {
        emitToUser(userId, "force_logout", {
          reason:
            reason.trim() ||
            "Thông tin tài khoản đã được quản trị viên cập nhật. Vui lòng đăng nhập lại.",
        });
      } catch (e) {
        console.error("Emit force_logout error:", e.message);
      }
    }

    return {
      ...updatedUser,
      update_reason: reason.trim(),
    };
  },

  async getUserChangeHistory({ userId, page = 1, limit = 10 }) {
    if (!userId) {
      throw httpError(400, "Thiếu định danh người dùng");
    }

    const user = await adminUserRepository.getUserDetail(userId);
    if (!user) {
      throw httpError(404, "Không tìm thấy người dùng");
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const { total, items } = await adminUserRepository.getUserChangeHistory({
      userId,
      limit: limitNum,
      offset,
    });

    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      items: items.map((item) => ({
        id: item.id,
        action: item.action,
        role_in_operation:
          item.role_in_operation ||
          (String(item.user_id) === String(userId) ? "SOURCE" : "DESTINATION"),
        reason: item.reason,
        old_values: item.old_values,
        new_values: item.new_values,
        admin: {
          id: item.admin_id,
          name: item.admin_name,
          email: item.admin_email,
        },
        created_at: item.created_at,
      })),
      pagination: {
        total_items: total,
        total_pages: totalPages,
        current_page: pageNum,
        limit: limitNum,
      },
    };
  },

  async verifyAdminStepUpPassword({ adminId, adminPassword }) {
    if (!adminId) {
      throw httpError(401, "Thiếu định danh quản trị viên");
    }
    if (typeof adminPassword !== "string" || adminPassword.length === 0) {
      throw httpError(400, "Mật khẩu xác nhận của Quản trị viên là bắt buộc");
    }

    const admin = await adminUserRepository.findAdminAuthById(adminId);
    if (!admin) {
      throw httpError(404, "Không tìm thấy tài khoản Quản trị viên");
    }

    if (admin.role !== "ADMIN") {
      throw httpError(403, "Tài khoản không có quyền Quản trị viên");
    }

    if (admin.status !== "ACTIVE") {
      throw httpError(403, "Tài khoản Quản trị viên đang bị khóa");
    }

    if (admin.locked_until) {
      if (admin.is_locked) {
        throw httpError(
          403,
          "Tài khoản Quản trị viên đang bị tạm khóa do nhập sai mật khẩu nhiều lần"
        );
      }
      await adminUserRepository.resetAdminFailedLogin(adminId);
    }

    const isCorrectPassword = await bcrypt.compare(
      adminPassword,
      admin.password_hash || ""
    );

    if (!isCorrectPassword) {
      const row = await adminUserRepository.registerAdminFailedLogin({
        adminId,
        maxAttempts: MAX_ADMIN_AUTH_ATTEMPTS,
        lockMinutes: ADMIN_LOCK_MINUTES,
      });
      const attempts = Number(
        row?.failed_login_attempts ?? MAX_ADMIN_AUTH_ATTEMPTS
      );
      const isLocked = attempts >= MAX_ADMIN_AUTH_ATTEMPTS;
      const err = httpError(
        isLocked ? 403 : 401,
        isLocked
          ? "Tài khoản Quản trị viên bị tạm khóa do nhập sai mật khẩu quá số lần quy định"
          : "Mật khẩu xác nhận của Quản trị viên không chính xác"
      );
      err.remainingAttempts = Math.max(MAX_ADMIN_AUTH_ATTEMPTS - attempts, 0);
      throw err;
    }

    if (Number(admin.failed_login_attempts || 0) > 0 || admin.locked_until) {
      await adminUserRepository.resetAdminFailedLogin(adminId);
    }

    return admin;
  },

  computeAdminP2PRequestHash({
    adminId,
    sourceUserId,
    destinationUserId,
    amount,
    description,
    reason,
    authorizationReference,
  }) {
    const canonicalPayload = JSON.stringify({
      actor_id: String(adminId),
      operation: "ADMIN_OP_P2P",
      source_user_id: String(sourceUserId),
      destination_user_id: String(destinationUserId),
      amount: Number(amount),
      description: description || "",
      reason: reason || "",
      authorization_reference: authorizationReference || "",
    });
    return crypto.createHash("sha256").update(canonicalPayload).digest("hex");
  },

  async executeAdminP2P({
    adminId,
    sourceUserId,
    destinationUserId,
    amount,
    description,
    reason,
    authorizationReference,
    adminPassword,
    idempotencyKey,
  }) {
    if (!adminId) {
      throw httpError(401, "Thiếu định danh quản trị viên");
    }

    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.trim().length === 0 ||
      idempotencyKey.trim().length > 100
    ) {
      throw httpError(
        400,
        "Header Idempotency-Key là bắt buộc và tối đa 100 ký tự"
      );
    }
    const cleanIdempotencyKey = idempotencyKey.trim();

    if (!sourceUserId || !destinationUserId) {
      throw httpError(400, "Thiếu định danh người gửi hoặc người nhận");
    }

    const cleanSourceId = String(sourceUserId).trim();
    const cleanDestId = String(destinationUserId).trim();

    if (cleanSourceId === cleanDestId) {
      throw httpError(
        400,
        "Không thể chuyển tiền cho chính mình (ví nguồn và ví đích trùng nhau)"
      );
    }

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < MIN_P2P_AMOUNT ||
      numAmount > MAX_P2P_AMOUNT
    ) {
      throw httpError(
        400,
        "Số tiền chuyển phải là số nguyên từ 1.000đ đến 50.000.000đ"
      );
    }

    if (
      typeof reason !== "string" ||
      reason.trim().length === 0 ||
      reason.trim().length > 500
    ) {
      throw httpError(
        400,
        "Lý do thực hiện giao dịch (reason) là bắt buộc và tối đa 500 ký tự"
      );
    }
    const cleanReason = reason.trim();

    if (
      typeof authorizationReference !== "string" ||
      !AUTH_REFERENCE_REGEX.test(authorizationReference.trim())
    ) {
      throw httpError(
        400,
        "Mã tham chiếu ủy quyền (authorization_reference) là bắt buộc và phải từ 5-100 ký tự (chữ, số, gạch ngang, gạch dưới)"
      );
    }
    const cleanAuthRef = authorizationReference.trim();

    const cleanDescription =
      typeof description === "string" && description.trim().length > 0
        ? description.trim().slice(0, 255)
        : `Admin hỗ trợ chuyển tiền (${cleanAuthRef})`;

    await this.verifyAdminStepUpPassword({
      adminId,
      adminPassword,
    });

    const requestHash = this.computeAdminP2PRequestHash({
      adminId,
      sourceUserId: cleanSourceId,
      destinationUserId: cleanDestId,
      amount: numAmount,
      description: cleanDescription,
      reason: cleanReason,
      authorizationReference: cleanAuthRef,
    });

    const inserted = await adminUserRepository.tryInsertIdempotencyKey({
      idempotencyKey: cleanIdempotencyKey,
      actorId: adminId,
      actorType: "ADMIN",
      requestPath: ADMIN_P2P_REQUEST_PATH,
      requestHash,
    });

    if (!inserted) {
      const existingKey = await adminUserRepository.getIdempotencyKey(
        cleanIdempotencyKey
      );
      if (!existingKey) {
        throw httpError(409, "Yêu cầu giao dịch đang được xử lý");
      }

      if (
        String(existingKey.actor_id) !== String(adminId) ||
        existingKey.request_path !== ADMIN_P2P_REQUEST_PATH ||
        existingKey.request_hash !== requestHash
      ) {
        throw httpError(
          422,
          "Mã Idempotency-Key đã được sử dụng với dữ liệu giao dịch khác"
        );
      }

      if (existingKey.status === "SUCCESS" && existingKey.response_body) {
        return {
          replayed: true,
          data: sanitizeP2PResponseData(existingKey.response_body),
          notificationContext: null,
        };
      }

      const reclaimed = await adminUserRepository.reclaimIdempotencyKey({
        idempotencyKey: cleanIdempotencyKey,
        actorId: adminId,
        requestPath: ADMIN_P2P_REQUEST_PATH,
        requestHash,
      });

      if (!reclaimed) {
        const latestKey = await adminUserRepository.getIdempotencyKey(
          cleanIdempotencyKey
        );
        if (
          latestKey &&
          latestKey.status === "SUCCESS" &&
          latestKey.response_body &&
          latestKey.request_hash === requestHash
        ) {
          return {
            replayed: true,
            data: sanitizeP2PResponseData(latestKey.response_body),
            notificationContext: null,
          };
        }
        throw httpError(
          409,
          "Yêu cầu giao dịch đang được xử lý, vui lòng không gửi trùng lặp"
        );
      }
    }

    try {
      const txResult = await adminUserRepository.executeAdminP2PWithHistory({
        adminId,
        sourceUserId: cleanSourceId,
        destinationUserId: cleanDestId,
        amount: numAmount,
        fee: 0,
        description: cleanDescription,
        reason: cleanReason,
        authorizationReference: cleanAuthRef,
        idempotencyKey: cleanIdempotencyKey,
        requestHash,
        requestPath: ADMIN_P2P_REQUEST_PATH,
      });

      return {
        replayed: Boolean(txResult.replayed),
        data: sanitizeP2PResponseData(txResult.responseBody),
        notificationContext: txResult.notificationContext || null,
      };
    } catch (e) {
      try {
        await adminUserRepository.markIdempotencyKeyFailed(cleanIdempotencyKey);
      } catch (markErr) {
        console.error("markIdempotencyKeyFailed error:", markErr.message);
      }
      throw e;
    }
  },
};

module.exports = adminUserService;
