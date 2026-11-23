// postpaid.service.js: Nghiệp vụ quản trị Ví trả sau (xem tổng quan, khóa/mở khóa, hạn mức, duyệt chứng minh thu nhập).
const adminPostpaidRepository = require("./postpaid.repository");
const { assertValidAdminId: assertSharedAdminId } = require("../shared/adminHelpers");
const {
  assertValidUuid,
  parseAdminReason,
  parseWalletListFilters,
  parseEntryListFilters,
  parseUnlockRequestFilters,
  parseLimitAdjustPayload,
  parseProofIndex,
} = require("./postpaid.validators");

const adminPostpaidService = {
  async getOverview() {
    return adminPostpaidRepository.getOverview();
  },

  async listWallets(query = {}) {
    const filters = parseWalletListFilters(query);
    return adminPostpaidRepository.listWallets(filters);
  },

  async getWalletDetail(userId) {
    const cleanUserId = assertValidUuid(userId, "user_id");
    return adminPostpaidRepository.getWalletDetail(cleanUserId);
  },

  async listEntries(query = {}) {
    const filters = parseEntryListFilters(query);
    return adminPostpaidRepository.listEntries(filters);
  },

  async freezeWallet({ userId, adminId, reason }) {
    const cleanUserId = assertValidUuid(userId, "user_id");
    const cleanAdminId = String(adminId || "").trim();
    assertSharedAdminId(
      cleanAdminId,
      "Không xác định được tài khoản Quản trị viên thực hiện thao tác",
    );
    const cleanReason = parseAdminReason(reason, "Lý do khóa Ví trả sau");
    return adminPostpaidRepository.freezeWallet({
      userId: cleanUserId,
      adminId: cleanAdminId,
      reason: cleanReason,
    });
  },

  async unfreezeWallet({ userId, adminId, reason }) {
    const cleanUserId = assertValidUuid(userId, "user_id");
    const cleanAdminId = String(adminId || "").trim();
    assertSharedAdminId(
      cleanAdminId,
      "Không xác định được tài khoản Quản trị viên thực hiện thao tác",
    );
    const cleanReason = parseAdminReason(reason, "Lý do mở khóa Ví trả sau");
    return adminPostpaidRepository.unfreezeWallet({
      userId: cleanUserId,
      adminId: cleanAdminId,
      reason: cleanReason,
    });
  },

  async adjustCreditLimit({ userId, adminId, credit_limit, reason }) {
    const cleanUserId = assertValidUuid(userId, "user_id");
    const cleanAdminId = String(adminId || "").trim();
    assertSharedAdminId(
      cleanAdminId,
      "Không xác định được tài khoản Quản trị viên thực hiện thao tác",
    );
    const { creditLimit, reason: cleanReason } = parseLimitAdjustPayload({
      credit_limit,
      reason,
    });
    return adminPostpaidRepository.adjustCreditLimit({
      userId: cleanUserId,
      adminId: cleanAdminId,
      creditLimit,
      reason: cleanReason,
    });
  },

  async listUnlockRequests(query = {}) {
    const filters = parseUnlockRequestFilters(query);
    return adminPostpaidRepository.listUnlockRequests(filters);
  },

  async getUnlockProofFilePath({ requestId, index }) {
    const cleanRequestId = assertValidUuid(requestId, "request_id");
    const proofIndex = parseProofIndex(index);
    return adminPostpaidRepository.getUnlockProofFilePath({
      requestId: cleanRequestId,
      proofIndex,
    });
  },

  async approveUnlockRequest({ requestId, adminId, reason }) {
    const cleanRequestId = assertValidUuid(requestId, "request_id");
    const cleanAdminId = String(adminId || "").trim();
    assertSharedAdminId(
      cleanAdminId,
      "Không xác định được tài khoản Quản trị viên thực hiện thao tác",
    );
    const cleanReason = parseAdminReason(
      reason,
      "Lý do duyệt mở khóa Ví trả sau",
    );
    return adminPostpaidRepository.approveUnlockRequest({
      requestId: cleanRequestId,
      adminId: cleanAdminId,
      reason: cleanReason,
    });
  },

  async rejectUnlockRequest({ requestId, adminId, reason }) {
    const cleanRequestId = assertValidUuid(requestId, "request_id");
    const cleanAdminId = String(adminId || "").trim();
    assertSharedAdminId(
      cleanAdminId,
      "Không xác định được tài khoản Quản trị viên thực hiện thao tác",
    );
    const cleanReason = parseAdminReason(
      reason,
      "Lý do từ chối mở khóa Ví trả sau",
    );
    return adminPostpaidRepository.rejectUnlockRequest({
      requestId: cleanRequestId,
      adminId: cleanAdminId,
      reason: cleanReason,
    });
  },
};

module.exports = adminPostpaidService;
