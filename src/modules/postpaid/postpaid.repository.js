// postpaid.repository.js: Truy vấn mở/khóa, thanh toán, hoàn tiền, chốt sao kê, phí trễ hạn và yêu cầu mở khóa Ví trả sau.
require("dotenv").config();
const pool = require("../../config/database");
const { httpError } = require("../../utils/common/http");
const { assertDailyLimit, assertWalletCapacity } = require("../../utils/limits/dailyLimit");
const { assertKyc } = require("../kyc/kyc.guard");
const paymentRequestRepository = require("../paymentRequest/paymentRequest.repository");
const webhookRepository = require("../webhook/webhook.repository");
const merchantFeeService = require("../merchant/production/fee/fee.service");
const {
  FEE_TYPES,
  assertSystemFeeWalletConfigured,
  serializeFeeRateSnapshot,
} = require("../fee/feeCalculator");
const {
  buildSystemPostpaidWalletSpec,
  verifySystemWalletInDb,
} = require("../../utils/payment/systemWallet");
const {
  MIN_AUTO_ADJUSTED_CREDIT_LIMIT,
  resolvePostpaidLateFeeTier,
  resolvePostpaidLimitReductionRule,
} = require("./postpaidConfig");
const { uuidv7 } = require("uuidv7");
const {
  POSTPAID_SYSTEM_CONFIG_KEYS,
  STATUS_CATALOG_LABEL,
  ACTION_CATALOG_LABEL,
  normalizePostpaidConfig,
  normalizePostpaidReminderConfig,
  assertSystemPostpaidWalletConfigured,
  getVnDateMeta,
  buildDueDateStr,
  formatCycleMonthDisplay,
  toYmdStr,
  diffDaysYmd,
  formatVnDateFromYmd,
  computeAutoAdjustedCreditLimit,
  buildMonthlyDebtReminderNotification,
  normalizePostpaidCatalog,
  requireCatalogCode,
  lockUsersByIdsOrdered,
  resolveActivationEligibility,
  lockSystemPostpaidWalletTx,
  recordAudit,
  formatVndDot,
  buildPostpaidInfoPayload,
  resolvePostpaidEntryActionFilter,
  findMatchingPostpaidActions,
} = require("./postpaid.helpers");

const postpaidRepository = {
  /** Đọc và chuẩn hóa bộ 3 cấu hình hệ thống (`POSTPAID_CONFIG`, `POSTPAID_STATUS`, `POSTPAID_ENTRY_ACTIONS`). */
  async getSystemCatalog(db = pool) {
    const keys = [
      POSTPAID_SYSTEM_CONFIG_KEYS.CONFIG,
      POSTPAID_SYSTEM_CONFIG_KEYS.STATUS,
      POSTPAID_SYSTEM_CONFIG_KEYS.ENTRY_ACTIONS,
    ];
    const res = await db.query(
      `SELECT key, value FROM system_configs WHERE key = ANY($1::text[])`,
      [keys],
    );
    const configMap = new Map(res.rows.map((r) => [r.key, r.value]));

    if (!configMap.has(POSTPAID_SYSTEM_CONFIG_KEYS.CONFIG)) {
      throw httpError(500, "Hệ thống chưa thiết lập cấu hình Ví trả sau");
    }
    if (!configMap.has(POSTPAID_SYSTEM_CONFIG_KEYS.STATUS)) {
      throw httpError(500, `Hệ thống chưa thiết lập ${STATUS_CATALOG_LABEL}`);
    }
    if (!configMap.has(POSTPAID_SYSTEM_CONFIG_KEYS.ENTRY_ACTIONS)) {
      throw httpError(500, `Hệ thống chưa thiết lập ${ACTION_CATALOG_LABEL}`);
    }

    const config = normalizePostpaidConfig(
      configMap.get(POSTPAID_SYSTEM_CONFIG_KEYS.CONFIG),
    );
    const statusCatalog = normalizePostpaidCatalog(
      configMap.get(POSTPAID_SYSTEM_CONFIG_KEYS.STATUS),
      STATUS_CATALOG_LABEL,
    );
    const entryActionCatalog = normalizePostpaidCatalog(
      configMap.get(POSTPAID_SYSTEM_CONFIG_KEYS.ENTRY_ACTIONS),
      ACTION_CATALOG_LABEL,
    );

    return {
      config,
      statuses: statusCatalog.codes,
      statusLabels: statusCatalog.labels,
      entryActions: entryActionCatalog.codes,
      entryActionLabels: entryActionCatalog.labels,
    };
  },

  /** Kiểm tra ví nguồn `SYSTEM_POSTPAID_WALLET` tồn tại, đúng role và không trùng với ví thu phí. */
  async verifySystemPostpaidWallet(db = pool) {
    return verifySystemWalletInDb(db, {
      walletId: assertSystemPostpaidWalletConfigured(),
      otherSystemWalletId: process.env.SYSTEM_FEE_WALLET_ID,
      collisionMessage:
        "Ví thu phí hệ thống và ví nguồn Ví trả sau không được trùng ID",
      spec: buildSystemPostpaidWalletSpec(),
    });
  },

  /** Lấy nhanh cấu hình tham số nghiệp vụ `POSTPAID_CONFIG` từ `system_configs`. */
  async getConfig(db = pool) {
    const catalog = await postpaidRepository.getSystemCatalog(db);
    return catalog.config;
  },

  /** Lấy và kiểm tra hợp lệ cấu hình nhắc nợ hàng tháng (`POSTPAID_REMINDER_CONFIG`). */
  async getReminderConfig(db = pool) {
    const res = await db.query(
      `SELECT value FROM system_configs WHERE key = $1 LIMIT 1`,
      [POSTPAID_SYSTEM_CONFIG_KEYS.REMINDER_CONFIG],
    );
    if (!res.rows[0]) {
      throw httpError(500, "Hệ thống chưa thiết lập cấu hình nhắc nợ Ví trả sau");
    }
    return normalizePostpaidReminderConfig(res.rows[0].value);
  },

  /** Trả về bộ quy tắc, biểu phí và điều kiện sử dụng cho API `GET /postpaid/info`. */
  async getWalletInfo(db = pool) {
    const catalog = await postpaidRepository.getSystemCatalog(db);
    return buildPostpaidInfoPayload(catalog);
  },

  /**
   * Tổng hợp toàn bộ trạng thái, số dư/dư nợ và điều kiện mở Ví trả sau của một user
   * để hiển thị màn hình Ví trả sau trên App (hoặc trả lại snapshot mới nhất sau khi cập nhật ví).
   */
  async getWalletOverview(userId, db = pool) {
    // 1. Truy vấn song song 7 nguồn dữ liệu: cấu hình hệ thống, thông tin user (+ tuổi tài khoản),
    //    trạng thái eKYC, ngân hàng liên kết, dữ liệu ví trả sau, yêu cầu mở khóa gần nhất và ví nguồn hệ thống
    const [catalog, userRes, kycRes, bankRes, walletRes, latestUnlockRes] = await Promise.all([
      postpaidRepository.getSystemCatalog(db),
      db.query(
        `SELECT id, role, status, balance, created_at,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS account_age_seconds
           FROM users
          WHERE id = $1`,
        [userId],
      ),
      db.query(
        `SELECT 1 FROM user_kyc WHERE user_id = $1 AND status = 'APPROVED' LIMIT 1`,
        [userId],
      ),
      db.query(
        `SELECT 1 FROM linked_bank_accounts WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        [userId],
      ),
      db.query(
        `SELECT user_id, status, credit_limit, used_amount, billed_amount,
                service_fee_amount, late_fee_amount, current_cycle_month, due_date,
                overdue_count, lock_reason, overdue_cycle_month, overdue_cycle_due_date,
                overdue_cycle_principal, activated_at, updated_at
           FROM postpaid_wallets
          WHERE user_id = $1`,
        [userId],
      ),
      db.query(
        `SELECT id, status, user_note, proof_image_paths, overdue_count_snapshot,
                credit_limit_snapshot, admin_note, reviewed_at, created_at, updated_at
           FROM postpaid_unlock_requests
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [userId],
      ),
      postpaidRepository.verifySystemPostpaidWallet(db),
    ]);

    // 2. Xác thực user tồn tại và kiểm tra đủ 3 điều kiện mở ví (eKYC, liên kết ngân hàng, tuổi tài khoản)
    const { config, statuses, statusLabels, entryActionLabels } = catalog;
    const user = userRes.rows[0];
    if (!user) {
      throw httpError(404, "Không tìm thấy thông tin người dùng");
    }

    const isKyc = kycRes.rows.length > 0;
    const hasLinkedBank = bankRes.rows.length > 0;
    const pw = walletRes.rows[0] || null;
    const eligibility = resolveActivationEligibility({
      user,
      isKyc,
      hasLinkedBank,
      config,
    });

    // 3. Chuẩn hóa trạng thái ví & tính toán hạn mức, từng cấu phần dư nợ / phí / hạn mức còn lại
    const inactiveStatus = requireCatalogCode(
      statuses,
      "INACTIVE",
      STATUS_CATALOG_LABEL,
    );
    const pastDueStatus = requireCatalogCode(
      statuses,
      "PAST_DUE",
      STATUS_CATALOG_LABEL,
    );
    const isActivated = Boolean(pw && pw.status !== inactiveStatus);

    // Nếu chưa kích hoạt: tạm hiển thị hạn mức mặc định theo cấu hình hệ thống và đưa dư nợ về 0
    const creditLimit = isActivated
      ? Number(pw.credit_limit)
      : config.default_credit_limit;
    const usedAmount = isActivated ? Number(pw.used_amount) : 0;
    const billedAmount = isActivated ? Number(pw.billed_amount) : 0;
    const serviceFeeAmount = isActivated ? Number(pw.service_fee_amount) : 0;
    const lateFeeAmount = isActivated ? Number(pw.late_fee_amount) : 0;
    // Dư nợ kỳ mới phát sinh (chưa chốt sao kê) = phần dư còn lại sau khi trừ gốc đã chốt và các khoản phí
    const unbilledAmount = isActivated
      ? Math.max(0, usedAmount - billedAmount - serviceFeeAmount - lateFeeAmount)
      : 0;
    const availableLimit = isActivated ? Math.max(0, creditLimit - usedAmount) : 0;
    const currentStatus = isActivated ? pw.status : inactiveStatus;
    const currentStatusLabel = requireCatalogCode(
      statusLabels,
      currentStatus,
      STATUS_CATALOG_LABEL,
    );

    // 4. Tính ngày đáo hạn hiệu lực (ưu tiên hạn gốc kỳ quá hạn nếu có) và số ngày trễ theo giờ VN
    const vnToday = getVnDateMeta().todayDateStr;
    const effectiveDueDateStr = isActivated
      ? toYmdStr(pw.overdue_cycle_due_date || pw.due_date)
      : null;
    const daysOverdue =
      isActivated &&
        currentStatus === pastDueStatus &&
        effectiveDueDateStr &&
        effectiveDueDateStr < vnToday
        ? diffDaysYmd(vnToday, effectiveDueDateStr)
        : 0;

    // 5. Chuẩn hóa thông tin yêu cầu gửi ảnh chứng minh thu nhập gần nhất (khi bị khóa OVERDUE_REPEAT)
    const latestReqRow = latestUnlockRes.rows[0] || null;
    const latestUnlockRequest = latestReqRow
      ? {
        id: latestReqRow.id,
        status: latestReqRow.status,
        user_note: latestReqRow.user_note || null,
        proof_count: Array.isArray(latestReqRow.proof_image_paths)
          ? latestReqRow.proof_image_paths.length
          : 0,
        overdue_count_snapshot: Number(latestReqRow.overdue_count_snapshot || 0),
        credit_limit_snapshot: Number(latestReqRow.credit_limit_snapshot || 0),
        admin_note: latestReqRow.admin_note || null,
        reviewed_at: latestReqRow.reviewed_at || null,
        created_at: latestReqRow.created_at,
        updated_at: latestReqRow.updated_at,
      }
      : null;

    // 6. Trả về object tổng quan gồm trạng thái, chỉ số tài chính, số dư ví chính, config và bộ nhãn hiển thị
    return {
      activated: isActivated,
      is_kyc: isKyc,
      has_linked_bank: hasLinkedBank,
      account_age_hours: eligibility.accountAgeHours,
      min_account_hours: eligibility.requiredHours,
      is_account_age_eligible: eligibility.isAccountAgeEligible,
      eligible_to_activate: !isActivated && eligibility.eligible,
      ineligible_reason: isActivated ? null : eligibility.ineligibleReason,
      status: currentStatus,
      status_label: currentStatusLabel,
      lock_reason: isActivated ? pw.lock_reason || null : null,
      overdue_count: pw ? Number(pw.overdue_count || 0) : 0,
      days_overdue: daysOverdue,
      credit_limit: creditLimit,
      used_amount: usedAmount,
      available_limit: availableLimit,
      billed_amount: billedAmount,
      service_fee_amount: serviceFeeAmount,
      late_fee_amount: lateFeeAmount,
      unbilled_amount: unbilledAmount,
      current_cycle_month: isActivated ? pw.current_cycle_month || null : null,
      due_date: effectiveDueDateStr,
      activated_at: isActivated ? pw.activated_at || null : null,
      updated_at: pw?.updated_at || null,
      latest_unlock_request: latestUnlockRequest,
      main_balance: Number(user.balance),
      config,
      status_labels: statusLabels,
      entry_action_labels: entryActionLabels,
    };
  },

  /**
   * Kích hoạt Ví trả sau cho người dùng:
   * - Kiểm tra tính năng bật, khóa user theo thứ tự UUID, xác minh 3 điều kiện (eKYC, ngân hàng, tuổi tài khoản).
   * - Tạo dòng mới trong `postpaid_wallets` hoặc kích hoạt lại nếu ví từng đóng (`INACTIVE`), ghi audit và trả về overview mới.
   */
  async activateWallet({ userId }) {
    const [{ config, statuses }] = await Promise.all([
      postpaidRepository.getSystemCatalog(pool),
      postpaidRepository.verifySystemPostpaidWallet(pool),
    ]);
    if (!config.enabled) {
      throw httpError(503, "Tính năng Ví trả sau hiện đang tạm bảo trì");
    }
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const inactiveStatus = requireCatalogCode(statuses, "INACTIVE", STATUS_CATALOG_LABEL);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Khóa bản ghi user và kiểm tra điều kiện eKYC + ngân hàng liên kết + tuổi tài khoản
      const usersMap = await lockUsersByIdsOrdered(client, [userId]);
      const user = usersMap.get(String(userId));
      if (!user) {
        throw httpError(404, "Không tìm thấy người dùng");
      }

      const [kycRes, bankRes] = await Promise.all([
        client.query(
          `SELECT 1 FROM user_kyc WHERE user_id = $1 AND status = 'APPROVED' LIMIT 1`,
          [userId],
        ),
        client.query(
          `SELECT 1 FROM linked_bank_accounts WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1`,
          [userId],
        ),
      ]);

      const eligibility = resolveActivationEligibility({
        user,
        isKyc: kycRes.rows.length > 0,
        hasLinkedBank: bankRes.rows.length > 0,
        config,
      });
      if (!eligibility.eligible) {
        throw httpError(eligibility.statusCode, eligibility.ineligibleReason);
      }

      // 2. Khóa ví trả sau hiện có (nếu từng tạo trước đó) để tránh kích hoạt trùng
      const existingRes = await client.query(
        `SELECT user_id, status FROM postpaid_wallets WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      const existingWallet = existingRes.rows[0] || null;
      if (existingWallet && existingWallet.status !== inactiveStatus) {
        throw httpError(409, "Ví trả sau đã được kích hoạt trước đó");
      }

      // 3. Nếu từng hủy ví -> khôi phục sạch về hạn mức mặc định; ngược lại -> INSERT bản ghi mới
      if (existingWallet) {
        await client.query(
          `UPDATE postpaid_wallets
              SET status = $2,
                  lock_reason = NULL,
                  credit_limit = $3,
                  used_amount = 0,
                  billed_amount = 0,
                  service_fee_amount = 0,
                  late_fee_amount = 0,
                  current_cycle_month = NULL,
                  due_date = NULL,
                  overdue_cycle_month = NULL,
                  overdue_cycle_due_date = NULL,
                  overdue_cycle_principal = 0,
                  activated_at = NOW(),
                  updated_at = NOW()
            WHERE user_id = $1`,
          [userId, activeStatus, config.default_credit_limit],
        );
      } else {
        await client.query(
          `INSERT INTO postpaid_wallets (
             user_id, status, lock_reason, credit_limit, used_amount, billed_amount, service_fee_amount, late_fee_amount
           )
           VALUES ($1, $2, NULL, $3, 0, 0, 0, 0)`,
          [userId, activeStatus, config.default_credit_limit],
        );
      }

      await recordAudit(client, "POSTPAID_ACTIVATED", {
        user_id: userId,
        credit_limit: config.default_credit_limit,
        reactivated: Boolean(existingWallet),
      });

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return postpaidRepository.getWalletOverview(userId);
  },

  /**
   * Helper dùng chung để chuyển trạng thái vòng đời Ví trả sau của user (tạm khóa / mở khóa / đóng ví)
   * trong cùng DB transaction: khóa user -> khóa `postpaid_wallets` -> chạy `validateWallet` -> UPDATE -> ghi audit.
   */
  async transitionWalletLifecycle({
    userId,
    nextStatusKey,
    nextLockReason = null,
    auditEvent,
    clearCycle = false,
    extraAuditPayload = {},
    validateWallet,
  }) {
    const [{ statuses }] = await Promise.all([
      postpaidRepository.getSystemCatalog(pool),
      postpaidRepository.verifySystemPostpaidWallet(pool),
    ]);
    const nextStatus = requireCatalogCode(
      statuses,
      nextStatusKey,
      STATUS_CATALOG_LABEL,
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const usersMap = await lockUsersByIdsOrdered(client, [userId]);
      const user = usersMap.get(String(userId));
      if (!user) {
        throw httpError(404, "Không tìm thấy người dùng");
      }
      if (user.role !== "USER") {
        throw httpError(403, "Loại tài khoản này chưa hỗ trợ Ví trả sau");
      }
      if (user.status !== "ACTIVE") {
        throw httpError(403, "Tài khoản đang bị khóa hoặc không khả dụng");
      }

      const pwRes = await client.query(
        `SELECT user_id, status, lock_reason, overdue_count, credit_limit, used_amount,
                billed_amount, service_fee_amount, late_fee_amount
           FROM postpaid_wallets
          WHERE user_id = $1
          FOR UPDATE`,
        [userId],
      );
      const pw = pwRes.rows[0] || null;
      validateWallet(pw, statuses);

      const clearCycleClause = clearCycle
        ? ", current_cycle_month = NULL, due_date = NULL, overdue_cycle_month = NULL, overdue_cycle_due_date = NULL, overdue_cycle_principal = 0"
        : "";
      await client.query(
        `UPDATE postpaid_wallets
            SET status = $1,
                lock_reason = $2${clearCycleClause},
                updated_at = NOW()
          WHERE user_id = $3`,
        [nextStatus, nextLockReason, userId],
      );

      await recordAudit(client, auditEvent, {
        user_id: userId,
        previous_status: pw.status,
        previous_lock_reason: pw.lock_reason || null,
        next_status: nextStatus,
        next_lock_reason: nextLockReason,
        ...extraAuditPayload,
      });

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return postpaidRepository.getWalletOverview(userId);
  },

  /** User tự tạm khóa Ví trả sau (`FROZEN` với lý do `USER_FREEZE`); chặn nếu ví chưa mở hoặc đang quá hạn. */
  async freezeWallet({ userId }) {
    return postpaidRepository.transitionWalletLifecycle({
      userId,
      nextStatusKey: "FROZEN",
      nextLockReason: "USER_FREEZE",
      auditEvent: "POSTPAID_FROZEN",
      validateWallet: (pw, statuses) => {
        const inactiveStatus = requireCatalogCode(statuses, "INACTIVE", STATUS_CATALOG_LABEL);
        const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
        const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
        const frozenStatus = requireCatalogCode(statuses, "FROZEN", STATUS_CATALOG_LABEL);

        if (!pw || pw.status === inactiveStatus) {
          throw httpError(404, "Bạn chưa kích hoạt Ví trả sau");
        }
        if (pw.status === frozenStatus) {
          throw httpError(409, "Ví trả sau đã được tạm khóa trước đó");
        }
        if (pw.status === pastDueStatus) {
          throw httpError(
            400,
            "Ví đang quá hạn thanh toán, vui lòng tất toán kỳ sao kê trước khi tạm khóa",
          );
        }
        if (pw.status !== activeStatus) {
          throw httpError(400, "Không thể tạm khóa Ví trả sau ở trạng thái hiện tại");
        }
      },
    });
  },

  /** User tự mở khóa Ví trả sau (chỉ cho phép khi bị khóa bởi `USER_FREEZE`, chặn `OVERDUE_REPEAT` và `ADMIN_FREEZE`). */
  async unfreezeWallet({ userId }) {
    return postpaidRepository.transitionWalletLifecycle({
      userId,
      nextStatusKey: "ACTIVE",
      nextLockReason: null,
      auditEvent: "POSTPAID_UNFROZEN",
      validateWallet: (pw, statuses) => {
        const inactiveStatus = requireCatalogCode(statuses, "INACTIVE", STATUS_CATALOG_LABEL);
        const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
        const frozenStatus = requireCatalogCode(statuses, "FROZEN", STATUS_CATALOG_LABEL);

        if (!pw || pw.status === inactiveStatus) {
          throw httpError(404, "Bạn chưa kích hoạt Ví trả sau");
        }
        if (pw.status === activeStatus) {
          throw httpError(409, "Ví trả sau hiện đang hoạt động");
        }
        if (pw.status !== frozenStatus) {
          throw httpError(400, "Chỉ có thể mở khóa khi Ví trả sau đang tạm khóa");
        }
        if (pw.lock_reason === "OVERDUE_REPEAT") {
          throw httpError(
            403,
            "Ví đang bị khóa do quá hạn từ lần thứ 2 trở lên. Vui lòng gửi yêu cầu mở khóa kèm ảnh chứng minh thu nhập để Quản trị viên xét duyệt",
          );
        }
        if (pw.lock_reason === "ADMIN_FREEZE") {
          throw httpError(
            403,
            "Ví trả sau đang bị Quản trị viên tạm khóa, bạn không thể tự mở khóa",
          );
        }
      },
    });
  },

  /** User đóng (hủy) Ví trả sau về `INACTIVE` và xóa thông tin kỳ hiện tại khi toàn bộ dư nợ/phí đều bằng 0. */
  async closeWallet({ userId, reason = "" }) {
    return postpaidRepository.transitionWalletLifecycle({
      userId,
      nextStatusKey: "INACTIVE",
      nextLockReason: null,
      auditEvent: "POSTPAID_CLOSED",
      clearCycle: true,
      extraAuditPayload: reason ? { reason } : {},
      validateWallet: (pw, statuses) => {
        const inactiveStatus = requireCatalogCode(statuses, "INACTIVE", STATUS_CATALOG_LABEL);
        const frozenStatus = requireCatalogCode(statuses, "FROZEN", STATUS_CATALOG_LABEL);
        if (!pw || pw.status === inactiveStatus) {
          throw httpError(404, "Ví trả sau chưa kích hoạt hoặc đã hủy trước đó");
        }
        if (
          pw.status === frozenStatus &&
          (pw.lock_reason === "OVERDUE_REPEAT" || pw.lock_reason === "ADMIN_FREEZE")
        ) {
          throw httpError(
            403,
            "Ví đang bị khóa bởi hệ thống/Quản trị viên, không thể tự hủy ví",
          );
        }
        if (
          Number(pw.used_amount) > 0 ||
          Number(pw.billed_amount) > 0 ||
          Number(pw.service_fee_amount) > 0 ||
          Number(pw.late_fee_amount) > 0
        ) {
          throw httpError(
            400,
            "Vui lòng thanh toán hết toàn bộ dư nợ trước khi hủy Ví trả sau",
          );
        }
      },
    });
  },

  /**
   * Lấy danh sách lịch sử biến động sổ cái Ví trả sau (`postpaid_entries`) của user
   * hỗ trợ phân trang cursor `(created_at, id)`, lọc theo `action`, khoảng ngày (giờ VN) và tìm kiếm không dấu.
   */
  async getEntries(
    userId,
    {
      cursorId = null,
      limit = 20,
      keyword = null,
      action = null,
      startDate = null,
      endDate = null,
    } = {},
    db = pool,
  ) {
    // 1. Chuẩn hóa giới hạn phân trang và kiểm tra cursor_id (UUID hợp lệ)
    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 50);
    const validCursorId =
      cursorId && String(cursorId).trim() !== "" ? String(cursorId).trim() : null;
    if (validCursorId && !UUID_RE.test(validCursorId)) {
      throw httpError(400, "cursor_id không hợp lệ");
    }
    const hasCursor = Boolean(validCursorId);

    // 2. Escape ký tự đặc biệt cho tìm kiếm ILIKE và đánh dấu lọc ngày
    const trimmedKeyword = keyword && String(keyword).trim() ? String(keyword).trim() : null;
    const hasKeyword = Boolean(trimmedKeyword);
    const safeKeyword = hasKeyword
      ? trimmedKeyword.replace(/[\\%_]/g, "\\$&")
      : null;

    const hasStartDate = Boolean(startDate);
    const hasEndDate = Boolean(endDate);

    // 3. Lấy danh mục action tiếng Việt để ánh xạ bộ lọc & tìm kiếm không dấu theo tên loại giao dịch
    const catalog = await postpaidRepository.getSystemCatalog(db);
    const { entryActions, entryActionLabels } = catalog;
    const filteredActions = resolvePostpaidEntryActionFilter(action, entryActions);
    const hasActions = Boolean(filteredActions && filteredActions.length > 0);
    const keywordMatchedActions = hasKeyword
      ? findMatchingPostpaidActions(entryActionLabels, trimmedKeyword)
      : null;

    // 4. Truy vấn keyset pagination trên postpaid_entries (join thêm counterparty & order_id của QR)
    const res = await db.query(
      `WITH cursor_ref AS (
         SELECT c.created_at
           FROM postpaid_entries c
          WHERE $2::boolean = true AND c.id = $3::uuid
          LIMIT 1
       )
       SELECT
         pe.id,
         pe.user_id,
         pe.tx_id,
         pe.ref_tx_id,
         pe.action,
         pe.amount,
         pe.delta_used,
         pe.used_before,
         pe.used_after,
         pe.cycle_month,
         pe.note,
         pe.created_at,
         COALESCE(du.full_name, su.full_name) AS counterparty_name,
         pr.order_id AS order_id
       FROM postpaid_entries pe
       LEFT JOIN transactions t ON t.id = COALESCE(pe.tx_id, pe.ref_tx_id)
       LEFT JOIN users du ON du.id = t.destination_user_id AND du.role <> 'SYSTEM'
       LEFT JOIN users su ON su.id = t.source_user_id AND su.role <> 'SYSTEM'
       LEFT JOIN payment_requests pr ON pr.transaction_id = COALESCE(pe.ref_tx_id, t.id)
       WHERE pe.user_id = $1
         AND (
           $2::boolean = false
           OR (pe.created_at, pe.id) < ((SELECT created_at FROM cursor_ref), $3::uuid)
         )
         AND ($7::boolean = false OR pe.created_at >= (($8::text)::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
         AND ($9::boolean = false OR pe.created_at < ((($10::text)::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
         AND ($11::boolean = false OR pe.action = ANY($12::text[]))
         AND (
           $5::boolean = false
           OR pe.id::text ILIKE '%' || $6 || '%'
           OR COALESCE(pe.tx_id, '') ILIKE '%' || $6 || '%'
           OR COALESCE(pe.ref_tx_id, '') ILIKE '%' || $6 || '%'
           OR COALESCE(pe.cycle_month, '') ILIKE '%' || $6 || '%'
           OR unaccent(COALESCE(pe.note, '')) ILIKE '%' || unaccent($6) || '%'
           OR COALESCE(pr.order_id, '') ILIKE '%' || $6 || '%'
           OR unaccent(COALESCE(du.full_name, su.full_name, '')) ILIKE '%' || unaccent($6) || '%'
           OR ('thanh toan ' || unaccent(COALESCE(du.full_name, su.full_name, ''))) ILIKE '%' || unaccent($6) || '%'
           OR ('hoan tien tu ' || unaccent(COALESCE(su.full_name, du.full_name, ''))) ILIKE '%' || unaccent($6) || '%'
           OR ($6 ~ '^[0-9.]+$' AND pe.amount::text LIKE '%' || REPLACE($6, '.', '') || '%')
           OR ($6 ~ '[/:-]' AND TO_CHAR(pe.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI - DD/MM/YYYY') ILIKE '%' || $6 || '%')
           OR (
             $6 ~ '[-/]'
             AND pe.cycle_month ~ '^\\d{4}-\\d{2}$'
             AND (
               (SUBSTRING(pe.cycle_month FROM 6 FOR 2) || '-' || LEFT(pe.cycle_month, 4)) ILIKE '%' || $6 || '%'
               OR (SUBSTRING(pe.cycle_month FROM 6 FOR 2) || '/' || LEFT(pe.cycle_month, 4)) ILIKE '%' || $6 || '%'
             )
           )
           OR ($13::text[] IS NOT NULL AND pe.action = ANY($13::text[]))
         )
       ORDER BY pe.created_at DESC, pe.id DESC
       LIMIT $4`,
      [
        userId,
        hasCursor,
        validCursorId,
        safeLimit,
        hasKeyword,
        safeKeyword,
        hasStartDate,
        startDate || null,
        hasEndDate,
        endDate || null,
        hasActions,
        filteredActions,
        keywordMatchedActions,
      ],
    );

    const rows = res.rows.map((row) => ({
      ...row,
      action_label: requireCatalogCode(
        entryActionLabels,
        row.action,
        ACTION_CATALOG_LABEL,
      ),
    }));
    const nextCursor = rows.length === safeLimit ? rows[rows.length - 1].id : null;

    return {
      entries: rows,
      next_cursor: nextCursor,
    };
  },

  /**
   * Thanh toán đơn QR (`payment_requests`) bằng nguồn tiền Ví trả sau:
   * - Kiểm tra đơn QR, eKYC, trạng thái ví ACTIVE, hạn mức khả dụng và hạn mức giao dịch/ngày.
   * - Trích tiền từ `SYSTEM_POSTPAID_WALLET` chuyển cho merchant (trừ phí merchant nếu có), tăng `used_amount`.
   * - Ghi nhận `transactions`, `fee_ledger_entries`, `postpaid_entries` (`PURCHASE`), đánh dấu QR đã thanh toán,
   *   gửi webhook + audit; nếu thất bại thì ghi giao dịch `FAILED` an toàn.
   */
  async processPostpaidQRPayment({ sourceUserId, referenceCode, idempotencyKey }) {
    const { config, statuses, entryActions } =
      await postpaidRepository.getSystemCatalog(pool);
    if (!config.enabled) {
      throw httpError(503, "Tính năng Ví trả sau hiện đang tạm bảo trì");
    }
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const inactiveStatus = requireCatalogCode(statuses, "INACTIVE", STATUS_CATALOG_LABEL);
    const purchaseAction = requireCatalogCode(
      entryActions,
      "PURCHASE",
      ACTION_CATALOG_LABEL,
    );

    const postpaidWalletId = assertSystemPostpaidWalletConfigured();
    const { walletId: feeWalletId } = assertSystemFeeWalletConfigured();
    if (String(feeWalletId) === String(postpaidWalletId)) {
      throw httpError(
        500,
        "Ví thu phí hệ thống và ví nguồn Ví trả sau không được trùng ID",
      );
    }

    const client = await pool.connect();
    let resultPayload;
    const failureCtx = {
      transactionType: "PAYMENT",
      sourceUserId,
      destinationUserId: null,
      amount: null,
      sourceBalance: null,
      feeRateSnapshot: { funding_source: "POSTPAID", reference_code: referenceCode },
      shouldRecordFailure: true,
    };

    try {
      await client.query("BEGIN");

      const targetRes = await client.query(
        `SELECT destination_user_id FROM payment_requests WHERE reference_code = $1`,
        [referenceCode],
      );
      if (!targetRes.rows[0]) {
        await assertKyc(sourceUserId);
        throw httpError(404, "Không tìm thấy mã QR");
      }

      const merchantId = targetRes.rows[0].destination_user_id;
      failureCtx.destinationUserId = merchantId;
      if (String(sourceUserId) === String(merchantId)) {
        throw httpError(400, "Không thể thanh toán cho chính mình");
      }

      // Luôn khóa ví USER/MERCHANT theo thứ tự UUID tăng dần trước payment_requests & postpaid_wallets;
      // SYSTEM_POSTPAID_WALLET khóa gần cuối (ngay trước khi trừ tiền) và SYSTEM_FEE_WALLET khóa cuối cùng.
      const usersMap = await lockUsersByIdsOrdered(client, [
        sourceUserId,
        merchantId,
      ]);
      const sourceUser = usersMap.get(String(sourceUserId));
      const destUser = usersMap.get(String(merchantId));

      if (!sourceUser || !destUser) {
        failureCtx.shouldRecordFailure = false;
        throw httpError(404, "Không tìm thấy thông tin người thanh toán hoặc cửa hàng");
      }
      failureCtx.sourceBalance = Number(sourceUser.balance);
      if (sourceUser.status !== "ACTIVE" || sourceUser.role === "SYSTEM") {
        throw httpError(403, "Tài khoản của bạn đang bị khóa hoặc không khả dụng");
      }
      if (destUser.status !== "ACTIVE" || destUser.role === "SYSTEM") {
        throw httpError(422, "Tài khoản người nhận không khả dụng");
      }
      if (destUser.role !== "MERCHANT") {
        failureCtx.shouldRecordFailure = false;
        throw httpError(
          400,
          "Ví trả sau chỉ áp dụng thanh toán mã QR của cửa hàng (Merchant)",
        );
      }

      const paymentRequest =
        await paymentRequestRepository.findByReferenceCodeForUpdate(
          client,
          referenceCode,
        );
      if (!paymentRequest) {
        throw httpError(404, "Không tìm thấy mã QR");
      }
      failureCtx.amount = Number(paymentRequest.amount);
      failureCtx.feeRateSnapshot = {
        funding_source: "POSTPAID",
        postpaid_action: "PURCHASE",
        reference_code: referenceCode,
        ...(paymentRequest.order_id ? { order_id: paymentRequest.order_id } : {}),
      };
      await assertKyc(sourceUserId);
      if (paymentRequest.status !== "PENDING") {
        throw httpError(409, "Mã QR không còn chờ thanh toán");
      }
      if (paymentRequest.paid_at != null || paymentRequest.is_expires) {
        throw httpError(400, "Mã QR này đã được thanh toán hoặc hết hạn");
      }

      const amountNum = Number(paymentRequest.amount);
      if (!Number.isSafeInteger(amountNum) || amountNum <= 0) {
        failureCtx.shouldRecordFailure = false;
        throw httpError(400, "Số tiền đơn thanh toán không hợp lệ");
      }

      const pwRes = await client.query(
        `SELECT user_id, status, credit_limit, used_amount, billed_amount, late_fee_amount
           FROM postpaid_wallets
          WHERE user_id = $1
          FOR UPDATE`,
        [sourceUserId],
      );
      const pw = pwRes.rows[0];
      if (pw) {
        failureCtx.feeRateSnapshot = {
          ...failureCtx.feeRateSnapshot,
          postpaid_available_after: Math.max(
            0,
            Number(pw.credit_limit) - Number(pw.used_amount),
          ),
        };
      }
      if (!pw || pw.status === inactiveStatus) {
        throw httpError(403, "Bạn chưa kích hoạt Ví trả sau");
      }
      if (pw.status === pastDueStatus) {
        throw httpError(
          403,
          "Ví trả sau đang có dư nợ quá hạn. Vui lòng thanh toán để tiếp tục sử dụng",
        );
      }
      if (pw.status !== activeStatus) {
        throw httpError(403, "Ví trả sau hiện đang tạm khóa");
      }

      const creditLimit = Number(pw.credit_limit);
      const usedBefore = Number(pw.used_amount);
      const availableBefore = creditLimit - usedBefore;
      if (amountNum > availableBefore) {
        throw httpError(422, "Hạn mức Ví trả sau khả dụng không đủ");
      }

      // Kiểm tra hạn mức chi tiêu theo ngày và tính phí merchant + kiểm tra trần số dư ví nhận
      await assertDailyLimit(client, {
        userId: sourceUserId,
        role: sourceUser.role,
        type: "PAYMENT",
        amount: amountNum,
        fee: 0,
      });

      const merchantFeeDetails =
        await merchantFeeService.resolveMerchantTxFeeDetailsTx(client, {
          merchantUser: destUser,
          amount: amountNum,
          transactionType: "PAYMENT",
        });
      const merchantFeeNum = Number(merchantFeeDetails.fee_amount || 0);
      if (!Number.isFinite(merchantFeeNum) || merchantFeeNum < 0 || merchantFeeNum > amountNum) {
        throw httpError(500, "Phí giao dịch merchant không hợp lệ");
      }

      const destBefore = Number(destUser.balance);
      const netAmount = amountNum - merchantFeeNum;
      await assertWalletCapacity(client, {
        userId: destUser.id,
        role: destUser.role,
        currentBalance: destBefore,
        inboundAmount: netAmount,
        isRecipient: true,
      });

      // Đã kiểm tra xong toàn bộ điều kiện nghiệp vụ mới khóa ví nguồn Ví trả sau ở cuối transaction
      const postpaidSysUser = await lockSystemPostpaidWalletTx(
        client,
        postpaidWalletId,
      );
      const sysBefore = Number(postpaidSysUser.balance);
      if (sysBefore < amountNum) {
        throw httpError(503, "Nguồn vốn Ví trả sau tạm thời không đủ");
      }

      const sysAfter = sysBefore - amountNum;
      const destAfter = destBefore + netAmount;
      const usedAfter = usedBefore + amountNum;

      if (sysBefore + destBefore !== sysAfter + destAfter + merchantFeeNum) {
        throw httpError(500, "Lỗi toàn vẹn số dư giao dịch");
      }

      await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
        sysAfter,
        postpaidWalletId,
      ]);
      await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
        destAfter,
        merchantId,
      ]);
      await client.query(
        `UPDATE postpaid_wallets
            SET used_amount = $1,
                updated_at = NOW()
          WHERE user_id = $2`,
        [usedAfter, sourceUserId],
      );

      // Lưu giao dịch thanh toán tổng, thu phí merchant (nếu có) và ghi sổ cái PURCHASE
      const description =
        paymentRequest.description || `Thanh toán QR ${referenceCode}`;
      const txInsertRes = await client.query(
        `INSERT INTO transactions (
           transaction_type,
           source_user_id, source_balance_before, source_balance_after,
           destination_user_id, dest_balance_before, dest_balance_after,
           amount, user_fee, merchant_fee, fee_rate_snapshot,
           description, idempotency_key, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10::jsonb, $11, $12, 'SUCCESS')
         RETURNING id, status, created_at`,
        [
          "PAYMENT",
          postpaidWalletId,
          sysBefore,
          sysAfter,
          merchantId,
          destBefore,
          destAfter,
          amountNum,
          merchantFeeNum,
          serializeFeeRateSnapshot(merchantFeeDetails?.fee_rate_snapshot),
          description,
          idempotencyKey,
        ],
      );

      const createdTx = txInsertRes.rows[0];
      const createdTxId = createdTx.id;

      if (merchantFeeNum > 0) {
        await merchantFeeService.creditSystemFeeWalletAndLedgerTx(client, {
          transactionId: createdTxId,
          merchantUserId: destUser.id,
          payerUserId: sourceUserId,
          feeType: FEE_TYPES.QR_FEE,
          amount: merchantFeeNum,
          rateSnapshot: merchantFeeDetails?.fee_rate_snapshot || {},
          idempotencyKey,
        });
      }

      await merchantFeeService.addMonthlyUsageTx(client, {
        userId: destUser.id,
        monthKey: merchantFeeDetails?.month_key || getVnDateMeta().cycleMonth,
        qrGrossDelta: amountNum,
      });

      await client.query(
        `INSERT INTO postpaid_entries (
           id, user_id, tx_id, action, amount, delta_used, used_before, used_after, note
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv7(),
          sourceUserId,
          createdTxId,
          purchaseAction,
          amountNum,
          amountNum,
          usedBefore,
          usedAfter,
          description,
        ],
      );

      const paidPr = await paymentRequestRepository.markAsPaid(client, {
        referenceCode,
        transactionId: createdTxId,
      });
      if (!paidPr) {
        throw httpError(409, "Mã QR này đã được thanh toán hoặc hết hạn");
      }

      await webhookRepository.enqueue(client, {
        paymentRequestId: paidPr.id,
        eventType: "payment.success",
      });

      await recordAudit(client, "PAYMENT_PAID", {
        payment_id: paidPr.id,
        order_id: paidPr.order_id ?? null,
        merchant_id: merchantId,
        payer_user_id: sourceUserId,
        funding_source: "POSTPAID",
        transaction_id: createdTxId,
        amount: amountNum,
        merchant_fee: merchantFeeNum,
        net_amount: netAmount,
        postpaid_used_before: usedBefore,
        postpaid_used_after: usedAfter,
      });

      await client.query("COMMIT");

      resultPayload = {
        transactionId: createdTxId,
        status: createdTx.status,
        createdAt: createdTx.created_at,
        amount: amountNum,
        fee: 0,
        feeAmount: 0,
        merchantFee: merchantFeeNum,
        feeRateSnapshot: merchantFeeDetails?.fee_rate_snapshot || null,
        netAmount,
        description,
        sourceUserName: sourceUser.full_name,
        destinationId: destUser.id,
        destinationUserName: destUser.full_name,
        destinationPhone: destUser.phone,
        sourceBalanceAfter: Number(sourceUser.balance),
        destBalanceAfter: destAfter,
        fundingSource: "POSTPAID",
        postpaidUsedAfter: usedAfter,
        postpaidAvailableAfter: creditLimit - usedAfter,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      if (failureCtx.shouldRecordFailure && Number(failureCtx.amount) > 0) {
        const { recordFailedTransactionSafe } = require("../transaction/transaction.repository");
        await recordFailedTransactionSafe({
          ...failureCtx,
          reason: e.message,
        });
      }
      throw e;
    } finally {
      client.release();
    }

    return resultPayload;
  },

  /**
   * Thanh toán (trả nợ) Ví trả sau từ Ví chính (`MAIN_WALLET`) hoặc Ngân hàng liên kết (`BANK`):
   * - Phân bổ tiền trả theo thứ tự ưu tiên cố định: (1) Phí trễ hạn -> (2) Phí dịch vụ -> (3) Gốc đã chốt -> (4) Gốc kỳ mới.
   * - Trừ tiền ví người trả / ngân hàng; cộng lại tiền gốc vào `SYSTEM_POSTPAID_WALLET` và phí vào `SYSTEM_FEE_WALLET`.
   * - Khi tất toán sạch kỳ đang quá hạn: tự động hạ hạn mức từ ngày trễ thứ 5 theo 4 bậc, đồng thời mở lại `ACTIVE`
   *   nếu là lần quá hạn 1 hoặc chuyển `FROZEN (OVERDUE_REPEAT)` nếu `overdue_count >= 2` (kèm dọn 3 cột `overdue_cycle_*`).
   */
  async repayDebt({
    userId,
    amount,
    idempotencyKey,
    fundingSource = "MAIN_WALLET",
    linkedBankAccountId = null,
    nowMs = Date.now(),
  }) {
    const repayAmount = Number(amount);
    if (!Number.isSafeInteger(repayAmount) || repayAmount <= 0) {
      throw httpError(400, "Số tiền thanh toán dư nợ không hợp lệ");
    }
    const normalizedFunding = String(
      fundingSource || (linkedBankAccountId ? "BANK" : "MAIN_WALLET"),
    )
      .trim()
      .toUpperCase();
    if (!["MAIN_WALLET", "BANK"].includes(normalizedFunding)) {
      throw httpError(400, "Nguồn tiền thanh toán không hợp lệ");
    }
    const isBankFunded = normalizedFunding === "BANK" || Boolean(linkedBankAccountId);
    if (isBankFunded && !linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
    }

    const { statuses, entryActions } =
      await postpaidRepository.getSystemCatalog(pool);
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const inactiveStatus = requireCatalogCode(statuses, "INACTIVE", STATUS_CATALOG_LABEL);
    const frozenStatus = requireCatalogCode(statuses, "FROZEN", STATUS_CATALOG_LABEL);
    const repayLateFeeAction = requireCatalogCode(
      entryActions,
      "REPAY_LATE_FEE",
      ACTION_CATALOG_LABEL,
    );
    const repayServiceFeeAction = requireCatalogCode(
      entryActions,
      "REPAY_SERVICE_FEE",
      ACTION_CATALOG_LABEL,
    );
    const repayPrincipalAction = requireCatalogCode(
      entryActions,
      "REPAY_PRINCIPAL",
      ACTION_CATALOG_LABEL,
    );
    const limitAdjustAction = requireCatalogCode(
      entryActions,
      "LIMIT_ADJUST",
      ACTION_CATALOG_LABEL,
    );
    const vnMeta = getVnDateMeta(nowMs);

    const postpaidWalletId = assertSystemPostpaidWalletConfigured();
    const { walletId: feeWalletId } = assertSystemFeeWalletConfigured();
    if (String(feeWalletId) === String(postpaidWalletId)) {
      throw httpError(
        500,
        "Ví thu phí hệ thống và ví nguồn Ví trả sau không được trùng ID",
      );
    }

    const client = await pool.connect();
    let resultPayload;
    const repayFailureCtx = {
      transactionType: "PAYMENT",
      sourceUserId: userId,
      destinationUserId: null,
      amount: repayAmount,
      linkedBankAccountId: isBankFunded ? linkedBankAccountId : null,
      sourceBalance: null,
      feeRateSnapshot: {
        funding_source: "POSTPAID",
        postpaid_action: "REPAY_PRINCIPAL",
        ...(isBankFunded ? { repay_funding_source: "BANK" } : {}),
      },
      shouldRecordFailure: true,
    };

    try {
      await client.query("BEGIN");

      // Khóa ví người trả nợ trước; ngân hàng liên kết (nếu có); rồi postpaid_wallets và các ví hệ thống ở cuối
      const usersMap = await lockUsersByIdsOrdered(client, [userId]);
      const user = usersMap.get(String(userId));

      if (!user) {
        repayFailureCtx.shouldRecordFailure = false;
        throw httpError(404, "Không tìm thấy người dùng");
      }
      repayFailureCtx.sourceBalance = Number(user.balance);
      if (user.status !== "ACTIVE" || user.role === "SYSTEM") {
        throw httpError(403, "Tài khoản của bạn đang bị khóa hoặc không khả dụng");
      }

      let bankRow = null;
      if (isBankFunded) {
        const bankRes = await client.query(
          `SELECT lba.id, lba.balance, b.name AS bank_name
             FROM linked_bank_accounts lba
             LEFT JOIN banks b ON lba.bank_id = b.id
            WHERE lba.id = $1 AND lba.user_id = $2 AND lba.status = 'ACTIVE'
            FOR UPDATE OF lba`,
          [linkedBankAccountId, userId],
        );
        bankRow = bankRes.rows[0] || null;
        if (!bankRow) {
          repayFailureCtx.linkedBankAccountId = null;
          throw httpError(404, "Không tìm thấy ngân hàng liên kết");
        }
      }

      const pwRes = await client.query(
        `SELECT user_id, status, lock_reason, overdue_count,
                last_overdue_counted_cycle, overdue_cycle_month,
                overdue_cycle_due_date, overdue_cycle_principal,
                last_limit_adjusted_cycle, credit_limit, used_amount,
                billed_amount, service_fee_amount, late_fee_amount,
                current_cycle_month, due_date
           FROM postpaid_wallets
          WHERE user_id = $1
          FOR UPDATE`,
        [userId],
      );
      const pw = pwRes.rows[0];
      if (!pw || pw.status === inactiveStatus) {
        throw httpError(404, "Bạn chưa kích hoạt Ví trả sau");
      }

      const creditLimit = Number(pw.credit_limit);
      const oldUsed = Number(pw.used_amount);
      const oldBilled = Number(pw.billed_amount);
      const oldServiceFee = Number(pw.service_fee_amount);
      const oldLateFee = Number(pw.late_fee_amount);

      if (oldUsed <= 0) {
        throw httpError(400, "Bạn hiện không có dư nợ Ví trả sau");
      }
      if (repayAmount > oldUsed) {
        throw httpError(400, "Số tiền thanh toán vượt quá tổng dư nợ hiện tại");
      }

      // 1. Tính phân bổ số tiền trả theo thứ tự: phí trễ hạn -> phí dịch vụ -> gốc đã chốt -> gốc kỳ mới
      const paidLateFee = Math.min(repayAmount, oldLateFee);
      const remainingAfterLateFee = repayAmount - paidLateFee;
      const paidServiceFee = Math.min(remainingAfterLateFee, oldServiceFee);
      const paidPrincipal = remainingAfterLateFee - paidServiceFee;
      const paidFeeTotal = paidLateFee + paidServiceFee;
      const effectiveRepayAction =
        paidPrincipal > 0
          ? repayPrincipalAction
          : paidLateFee > 0
            ? repayLateFeeAction
            : repayServiceFeeAction;
      repayFailureCtx.feeRateSnapshot = {
        funding_source: "POSTPAID",
        postpaid_action: effectiveRepayAction,
        ...(isBankFunded ? { repay_funding_source: "BANK" } : {}),
      };

      // 2. Xác minh và tính trước số dư nguồn tiền trả nợ (ngân hàng liên kết hoặc ví chính)
      const userBefore = Number(user.balance);
      let userAfter = userBefore;
      let bankBalanceBefore = null;
      let bankBalanceAfter = null;
      if (isBankFunded) {
        bankBalanceBefore = Number(bankRow.balance);
        if (bankBalanceBefore < repayAmount) {
          throw httpError(
            422,
            "Số dư tài khoản ngân hàng không đủ để thanh toán dư nợ",
          );
        }
        bankBalanceAfter = bankBalanceBefore - repayAmount;
      } else {
        if (userBefore < repayAmount) {
          throw httpError(422, "Số dư ví chính không đủ để thanh toán dư nợ");
        }
        userAfter = userBefore - repayAmount;
      }

      const newLateFee = oldLateFee - paidLateFee;
      const newServiceFee = oldServiceFee - paidServiceFee;
      const billedDeduction = Math.min(paidPrincipal, oldBilled);
      const newBilled = oldBilled - billedDeduction;
      const newUsed = oldUsed - repayAmount;

      if (newBilled + newServiceFee + newLateFee > newUsed) {
        throw httpError(500, "Lỗi toàn vẹn công thức trừ nợ Ví trả sau");
      }

      const isSettlingDebtCycle =
        newLateFee === 0 && newServiceFee === 0 && newBilled === 0;
      const effectiveDueDateStr = toYmdStr(pw.overdue_cycle_due_date || pw.due_date);
      // 3. Nếu tất toán sạch kỳ quá hạn (gốc đã chốt + phí = 0):
      //    cập nhật overdue_count (chống cộng trùng kỳ), tính giảm hạn mức từ ngày trễ thứ 5,
      //    mở khóa ACTIVE (lần 1) hoặc chuyển FROZEN/OVERDUE_REPEAT (từ lần 2) và xóa 3 cột overdue_cycle_*
      const effectiveOverdueCycle =
        pw.overdue_cycle_month || pw.current_cycle_month || vnMeta.cycleMonth;
      const daysOverdue =
        effectiveDueDateStr && vnMeta.todayDateStr > effectiveDueDateStr
          ? diffDaysYmd(vnMeta.todayDateStr, effectiveDueDateStr)
          : 0;
      const isOverdueCycle =
        isSettlingDebtCycle &&
        (pw.status === pastDueStatus || daysOverdue >= 1);

      let nextOverdueCount = Number(pw.overdue_count || 0);
      let nextLastOverdueCountedCycle = pw.last_overdue_counted_cycle || null;
      if (isOverdueCycle && nextLastOverdueCountedCycle !== effectiveOverdueCycle) {
        nextOverdueCount += 1;
        nextLastOverdueCountedCycle = effectiveOverdueCycle;
      }

      let nextCreditLimit = creditLimit;
      let nextLastLimitAdjustedCycle = pw.last_limit_adjusted_cycle || null;
      let limitAdjustmentDelta = 0;
      let appliedLimitReductionRule = null;
      const cycleOverduePrincipal =
        Number(pw.overdue_cycle_principal || 0) > 0
          ? Number(pw.overdue_cycle_principal)
          : oldBilled;
      if (
        isOverdueCycle &&
        daysOverdue >= 5 &&
        nextLastLimitAdjustedCycle !== effectiveOverdueCycle &&
        cycleOverduePrincipal > 0
      ) {
        const limitRule = resolvePostpaidLimitReductionRule(daysOverdue);
        const candidateLimit = computeAutoAdjustedCreditLimit(
          creditLimit,
          daysOverdue,
        );
        if (candidateLimit < creditLimit) {
          nextCreditLimit = candidateLimit;
          limitAdjustmentDelta = creditLimit - candidateLimit;
          nextLastLimitAdjustedCycle = effectiveOverdueCycle;
          appliedLimitReductionRule = limitRule;
        }
      }

      let newStatus = pw.status;
      let newLockReason = pw.lock_reason || null;
      if (isSettlingDebtCycle) {
        if (pw.status === frozenStatus && pw.lock_reason === "ADMIN_FREEZE") {
          newStatus = frozenStatus;
          newLockReason = "ADMIN_FREEZE";
        } else if (isOverdueCycle) {
          if (nextOverdueCount >= 2) {
            newStatus = frozenStatus;
            newLockReason = "OVERDUE_REPEAT";
          } else {
            newStatus = activeStatus;
            newLockReason = null;
          }
        }
      }

      const nextDueDateAfter = isSettlingDebtCycle ? null : pw.due_date;
      const nextOverdueCycleMonthAfter = isSettlingDebtCycle
        ? null
        : pw.overdue_cycle_month;
      const nextOverdueCycleDueDateAfter = isSettlingDebtCycle
        ? null
        : pw.overdue_cycle_due_date;
      const nextOverdueCyclePrincipalAfter = isSettlingDebtCycle
        ? 0
        : Number(pw.overdue_cycle_principal || 0);

      const sysWallet = await lockSystemPostpaidWalletTx(
        client,
        postpaidWalletId,
      );
      const sysBefore = Number(sysWallet.balance);
      const sysAfter = sysBefore + paidPrincipal;

      if (isBankFunded) {
        await client.query(
          `UPDATE linked_bank_accounts SET balance = $1 WHERE id = $2`,
          [bankBalanceAfter, linkedBankAccountId],
        );
      } else {
        await client.query(
          `UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`,
          [userAfter, userId],
        );
      }

      if (paidPrincipal > 0) {
        await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
          sysAfter,
          postpaidWalletId,
        ]);
      }

      const description =
        paidFeeTotal > 0 && paidPrincipal > 0
          ? "Thanh toán dư nợ & phí Ví trả sau"
          : paidLateFee > 0 && paidServiceFee > 0
            ? "Thanh toán phí trễ hạn & phí dịch vụ Ví trả sau"
            : paidLateFee > 0
              ? "Thanh toán phí trễ hạn Ví trả sau"
              : paidServiceFee > 0
                ? "Thanh toán phí dịch vụ Ví trả sau"
                : "Thanh toán dư nợ Ví trả sau";

      const hasPrincipal = paidPrincipal > 0;
      const repaySnapshot =
        isBankFunded || paidFeeTotal > 0
          ? {
            funding_source: "POSTPAID",
            postpaid_action: effectiveRepayAction,
            ...(isBankFunded ? { repay_funding_source: "BANK" } : {}),
            ...(paidFeeTotal > 0
              ? {
                cycle_month: pw.current_cycle_month,
                late_fee_paid: paidLateFee,
                service_fee_paid: paidServiceFee,
              }
              : {}),
          }
          : null;

      const txInsertRes = await client.query(
        `INSERT INTO transactions (
           transaction_type,
           source_user_id, source_balance_before, source_balance_after,
           destination_user_id, dest_balance_before, dest_balance_after,
           amount, user_fee, merchant_fee, fee_rate_snapshot,
           description, idempotency_key, status, linked_bank_account_id
         )
         VALUES ('PAYMENT', $1, $2, $3, $4, $5, $6, $7, $8, 0, $9::jsonb, $10, $11, 'SUCCESS', $12)
         RETURNING id, status, created_at`,
        [
          userId,
          userBefore,
          userAfter,
          hasPrincipal ? postpaidWalletId : null,
          hasPrincipal ? sysBefore : null,
          hasPrincipal ? sysAfter : null,
          hasPrincipal ? paidPrincipal : paidFeeTotal,
          hasPrincipal ? paidFeeTotal : 0,
          serializeFeeRateSnapshot(repaySnapshot),
          description,
          idempotencyKey,
          isBankFunded ? linkedBankAccountId : null,
        ],
      );

      const createdTx = txInsertRes.rows[0];
      const createdTxId = createdTx.id;
      let cursorUsed = oldUsed;

      for (const feePart of [
        {
          amount: paidLateFee,
          feeType: FEE_TYPES.POSTPAID_LATE_FEE,
          action: repayLateFeeAction,
          note: "Trả phí trễ hạn Ví trả sau",
        },
        {
          amount: paidServiceFee,
          feeType: FEE_TYPES.POSTPAID_SERVICE_FEE,
          action: repayServiceFeeAction,
          note: "Thanh toán phí dịch vụ Ví trả sau",
        },
      ]) {
        if (feePart.amount <= 0) continue;

        await merchantFeeService.creditSystemFeeWalletAndLedgerTx(client, {
          transactionId: createdTxId,
          payerUserId: userId,
          feeType: feePart.feeType,
          amount: feePart.amount,
          rateSnapshot: {
            cycle_month: pw.current_cycle_month,
            fee_type: feePart.feeType,
          },
          idempotencyKey,
        });

        const usedAfterPart = cursorUsed - feePart.amount;
        await client.query(
          `INSERT INTO postpaid_entries (
             id, user_id, tx_id, action, amount, delta_used, used_before, used_after, cycle_month, note
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv7(),
            userId,
            createdTxId,
            feePart.action,
            feePart.amount,
            -feePart.amount,
            cursorUsed,
            usedAfterPart,
            pw.current_cycle_month,
            feePart.note,
          ],
        );
        cursorUsed = usedAfterPart;
      }

      if (paidPrincipal > 0) {
        await client.query(
          `INSERT INTO postpaid_entries (
             id, user_id, tx_id, action, amount, delta_used, used_before, used_after, cycle_month, note
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv7(),
            userId,
            createdTxId,
            repayPrincipalAction,
            paidPrincipal,
            -paidPrincipal,
            cursorUsed,
            newUsed,
            pw.current_cycle_month,
            "Thanh toán gốc dư nợ Ví trả sau",
          ],
        );
      }

      if (limitAdjustmentDelta > 0) {
        const rawReduced = appliedLimitReductionRule
          ? Math.floor((creditLimit * (100 - appliedLimitReductionRule.reductionPercent)) / 100)
          : nextCreditLimit;
        const floorNote =
          nextCreditLimit > rawReduced
            ? `, giữ mức tối thiểu ${formatVndDot(MIN_AUTO_ADJUSTED_CREDIT_LIMIT)}`
            : "";
        const reductionDetail = appliedLimitReductionRule
          ? `giảm ${appliedLimitReductionRule.reductionPercent}% (Bậc ${appliedLimitReductionRule.tier}: ${appliedLimitReductionRule.label}, quá hạn ${daysOverdue} ngày${floorNote})`
          : `sau quá hạn ${daysOverdue} ngày`;
        await client.query(
          `INSERT INTO postpaid_entries (
             id, user_id, tx_id, action, amount, delta_used, used_before, used_after, cycle_month, note
           )
           VALUES ($1, $2, $3, $4, $5, 0, $6, $6, $7, $8)`,
          [
            uuidv7(),
            userId,
            createdTxId,
            limitAdjustAction,
            limitAdjustmentDelta,
            newUsed,
            effectiveOverdueCycle,
            `Hệ thống tự động điều chỉnh hạn mức ${reductionDetail}: ${formatVndDot(creditLimit)} → ${formatVndDot(nextCreditLimit)}`,
          ],
        );
      }

      await client.query(
        `UPDATE postpaid_wallets
            SET used_amount = $1,
                billed_amount = $2,
                service_fee_amount = $3,
                late_fee_amount = $4,
                credit_limit = $5,
                status = $6,
                lock_reason = $7,
                overdue_count = $8,
                last_overdue_counted_cycle = $9,
                due_date = $10,
                overdue_cycle_month = $11,
                overdue_cycle_due_date = $12,
                overdue_cycle_principal = $13,
                last_limit_adjusted_cycle = $14,
                updated_at = NOW()
          WHERE user_id = $15`,
        [
          newUsed,
          newBilled,
          newServiceFee,
          newLateFee,
          nextCreditLimit,
          newStatus,
          newLockReason,
          nextOverdueCount,
          nextLastOverdueCountedCycle,
          nextDueDateAfter,
          nextOverdueCycleMonthAfter,
          nextOverdueCycleDueDateAfter,
          nextOverdueCyclePrincipalAfter,
          nextLastLimitAdjustedCycle,
          userId,
        ],
      );

      await recordAudit(client, "POSTPAID_REPAY", {
        user_id: userId,
        transaction_id: createdTxId,
        funding_source: isBankFunded ? "BANK" : "MAIN_WALLET",
        linked_bank_account_id: isBankFunded ? linkedBankAccountId : null,
        bank_balance_before: bankBalanceBefore,
        bank_balance_after: bankBalanceAfter,
        repay_amount: repayAmount,
        paid_late_fee: paidLateFee,
        paid_service_fee: paidServiceFee,
        paid_principal: paidPrincipal,
        used_before: oldUsed,
        used_after: newUsed,
        billed_after: newBilled,
        service_fee_after: newServiceFee,
        late_fee_after: newLateFee,
        credit_limit_before: creditLimit,
        credit_limit_after: nextCreditLimit,
        limit_adjusted: limitAdjustmentDelta > 0,
        overdue_count: nextOverdueCount,
        lock_reason_after: newLockReason,
        status_after: newStatus,
      });

      await client.query("COMMIT");

      resultPayload = {
        transactionId: createdTxId,
        status: createdTx.status,
        createdAt: createdTx.created_at,
        amount: repayAmount,
        paidPrincipal,
        paidServiceFee,
        paidLateFee,
        mainBalanceAfter: userAfter,
        fundingSource: isBankFunded ? "BANK" : "MAIN_WALLET",
        bankName: bankRow?.bank_name || null,
        usedAmountAfter: newUsed,
        creditLimitAfter: nextCreditLimit,
        limitAdjusted: limitAdjustmentDelta > 0,
        availableLimitAfter: Math.max(0, nextCreditLimit - newUsed),
        billedAmountAfter: newBilled,
        serviceFeeAfter: newServiceFee,
        lateFeeAfter: newLateFee,
        postpaidStatus: newStatus,
        lockReasonAfter: newLockReason,
        overdueCountAfter: nextOverdueCount,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      if (repayFailureCtx.shouldRecordFailure && Number(repayFailureCtx.amount) > 0) {
        const { recordFailedTransactionSafe } = require("../transaction/transaction.repository");
        await recordFailedTransactionSafe({
          ...repayFailureCtx,
          reason: e.message,
        });
      }
      throw e;
    } finally {
      client.release();
    }

    return resultPayload;
  },

  /**
   * Thực thi hoàn tiền giao dịch thanh toán Merchant bằng Ví trả sau bên trong DB transaction
   * đã giữ khóa ví (tạo giao dịch `transaction_type = 'REFUND'` cho phần hoàn nợ về `SYSTEM_POSTPAID_WALLET`
   * và phần dư về ví chính người mua nếu có, đồng thời cập nhật `postpaid_wallets` & `postpaid_entries`).
   */
  async executePostpaidReversalWithinTx(
    client,
    {
      txRow,
      purchaseEntry = null,
      merchantUser,
      buyerUser,
      reason = "",
      idempotencyKey,
    },
  ) {
    if (!client || typeof client.query !== "function") {
      throw httpError(500, "Thiếu kết nối transaction để hoàn tiền Ví trả sau");
    }
    if (!txRow || !txRow.id) {
      throw httpError(404, "Không tìm thấy giao dịch gốc");
    }
    if (txRow.status !== "SUCCESS" || txRow.transaction_type !== "PAYMENT") {
      throw httpError(422, "Chỉ hỗ trợ hoàn tiền cho giao dịch thanh toán Merchant đã thành công");
    }
    if (!idempotencyKey) {
      throw httpError(400, "Thiếu Idempotency-Key cho giao dịch hoàn tiền");
    }
    if (!merchantUser?.id || !buyerUser?.id) {
      throw httpError(404, "Không tìm thấy tài khoản liên quan để hoàn tiền");
    }
    if (merchantUser.role !== "MERCHANT") {
      throw httpError(422, "Chỉ hỗ trợ hoàn tiền cho giao dịch thanh toán tại cửa hàng Merchant");
    }
    if (buyerUser.role === "SYSTEM") {
      throw httpError(422, "Không thể hoàn tiền về tài khoản hệ thống");
    }
    if (merchantUser.status !== "ACTIVE" || buyerUser.status !== "ACTIVE") {
      throw httpError(
        403,
        "Cả tài khoản khách hàng và ví Merchant đều phải đang ở trạng thái ACTIVE",
      );
    }

    const cleanTxId = String(txRow.id);
    const { statuses, entryActions } =
      await postpaidRepository.getSystemCatalog(client);
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const frozenStatus = requireCatalogCode(statuses, "FROZEN", STATUS_CATALOG_LABEL);
    const purchaseAction = requireCatalogCode(
      entryActions,
      "PURCHASE",
      ACTION_CATALOG_LABEL,
    );
    const refundAction = requireCatalogCode(
      entryActions,
      "REFUND",
      ACTION_CATALOG_LABEL,
    );
    const statementCloseAction = requireCatalogCode(
      entryActions,
      "STATEMENT_CLOSE",
      ACTION_CATALOG_LABEL,
    );
    const postpaidWalletId = assertSystemPostpaidWalletConfigured();

    let resolvedPurchaseEntry = purchaseEntry;
    if (!resolvedPurchaseEntry) {
      const purchaseRes = await client.query(
        `SELECT id, user_id, amount, cycle_month, created_at
           FROM postpaid_entries
          WHERE tx_id = $1 AND action = $2
          LIMIT 1`,
        [cleanTxId, purchaseAction],
      );
      resolvedPurchaseEntry = purchaseRes.rows[0] || null;
      if (!resolvedPurchaseEntry) {
        throw httpError(422, "Giao dịch này không phải giao dịch thanh toán bằng Ví trả sau");
      }
    }

    const refundedSumRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS refunded_total
         FROM postpaid_entries
        WHERE ref_tx_id = $1 AND action = $2`,
      [cleanTxId, refundAction],
    );
    const alreadyRefunded = Number(refundedSumRes.rows[0]?.refunded_total || 0);
    const originalAmount = Number(txRow.amount);
    const remainingRefundable = originalAmount - alreadyRefunded;
    if (remainingRefundable <= 0) {
      const err = httpError(409, "Giao dịch Ví trả sau này đã được hoàn đủ trước đó");
      err.code = "POSTPAID_ALREADY_FULLY_REFUNDED";
      throw err;
    }

    // Luôn hoàn 100% giá trị còn lại cho giao dịch Ví trả sau
    const actualRefundAmount = remainingRefundable;
    const merchantId = String(merchantUser.id);
    const buyerUserId = String(buyerUser.id);

    const pwRes = await client.query(
      `SELECT user_id, status, lock_reason, overdue_count, credit_limit,
              used_amount, billed_amount, service_fee_amount, late_fee_amount
         FROM postpaid_wallets
        WHERE user_id = $1
        FOR UPDATE`,
      [buyerUserId],
    );
    const pw = pwRes.rows[0];
    if (!pw) {
      throw httpError(404, "Không tìm thấy Ví trả sau của người mua");
    }

    const merchantBefore = Number(merchantUser.balance);
    if (!Number.isFinite(merchantBefore) || !Number.isFinite(Number(buyerUser.balance))) {
      throw httpError(500, "Dữ liệu số dư ví không hợp lệ");
    }
    if (merchantBefore < actualRefundAmount) {
      const err = httpError(
        422,
        "Ví Merchant hiện không đủ số dư để thực hiện hoàn tiền 100% giá trị giao dịch",
      );
      err.code = "INSUFFICIENT_BALANCE_FOR_REVERSAL";
      throw err;
    }

    const oldUsed = Number(pw.used_amount);
    const oldBilled = Number(pw.billed_amount);
    const oldServiceFee = Number(pw.service_fee_amount);
    const oldLateFee = Number(pw.late_fee_amount);

    const principalDebtRemaining = Math.max(
      0,
      oldUsed - oldServiceFee - oldLateFee,
    );
    const creditToReduce = Math.min(actualRefundAmount, principalDebtRemaining);
    const excessToMainWallet = actualRefundAmount - creditToReduce;
    const newUsed = oldUsed - creditToReduce;

    const stmtRes = await client.query(
      `SELECT created_at
         FROM postpaid_entries
        WHERE user_id = $1 AND action = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [buyerUserId, statementCloseAction],
    );
    const lastStatementCloseAt = stmtRes.rows[0]?.created_at
      ? new Date(stmtRes.rows[0].created_at).getTime()
      : null;
    const purchaseTime = new Date(txRow.created_at).getTime();
    const maxAllowedBilled = Math.max(0, newUsed - oldServiceFee - oldLateFee);

    let newBilled = oldBilled;
    if (lastStatementCloseAt !== null && purchaseTime <= lastStatementCloseAt) {
      newBilled = Math.max(0, oldBilled - Math.min(creditToReduce, oldBilled));
    }
    if (newBilled > maxAllowedBilled) {
      newBilled = maxAllowedBilled;
    }

    const isClearingPastDueViaRefund =
      pw.status === pastDueStatus &&
      oldLateFee === 0 &&
      oldServiceFee === 0 &&
      newBilled === 0;
    let newStatus = pw.status;
    let newLockReason = pw.lock_reason || null;
    if (isClearingPastDueViaRefund) {
      if (Number(pw.overdue_count || 0) >= 2) {
        newStatus = frozenStatus;
        newLockReason = "OVERDUE_REPEAT";
      } else {
        newStatus = activeStatus;
        newLockReason = null;
      }
    }

    const buyerBefore = Number(buyerUser.balance);
    if (excessToMainWallet > 0) {
      await assertWalletCapacity(client, {
        userId: buyerUserId,
        role: buyerUser.role,
        currentBalance: buyerBefore,
        inboundAmount: excessToMainWallet,
        isRecipient: true,
      });
    }

    const baseSnapshot = {
      operation_type: "REVERSAL",
      reversal_of_transaction_id: cleanTxId,
      exempt_reason: "ADMIN_REVERSAL",
      original_funding_source: "POSTPAID",
      postpaid_split: {
        credit_to_postpaid: creditToReduce,
        excess_to_main_wallet: excessToMainWallet,
      },
    };

    let merchantCursorBalance = merchantBefore;
    let primaryRefundTxId = null;
    let primaryRefundCreatedAt = null;
    let primaryRefundStatus = "SUCCESS";
    let excessTxId = null;
    const refundNote =
      (reason && String(reason).trim()) ||
      `Hoàn tiền thanh toán Merchant cho giao dịch ${cleanTxId}`;

    if (creditToReduce > 0) {
      const sysWallet = await lockSystemPostpaidWalletTx(
        client,
        postpaidWalletId,
      );
      const sysBefore = Number(sysWallet.balance);
      const mBefore = merchantCursorBalance;
      const mAfter = mBefore - creditToReduce;
      merchantCursorBalance = mAfter;
      const sAfter = sysBefore + creditToReduce;

      await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
        sAfter,
        postpaidWalletId,
      ]);

      const tx1Snapshot = {
        ...baseSnapshot,
        postpaid_leg: "DEBT_RESTORATION",
      };
      const tx1Res = await client.query(
        `INSERT INTO transactions (
           transaction_type,
           source_user_id, source_balance_before, source_balance_after,
           destination_user_id, dest_balance_before, dest_balance_after,
           amount, user_fee, merchant_fee, fee_rate_snapshot,
           description, idempotency_key, status, linked_bank_account_id
         )
         VALUES ('REFUND', $1, $2, $3, $4, $5, $6, $7, 0, 0, $8::jsonb, $9, $10, 'SUCCESS', NULL)
         RETURNING id, status, created_at`,
        [
          merchantId,
          mBefore,
          mAfter,
          postpaidWalletId,
          sysBefore,
          sAfter,
          creditToReduce,
          serializeFeeRateSnapshot(tx1Snapshot),
          refundNote,
          excessToMainWallet > 0 ? `${idempotencyKey}:postpaid` : idempotencyKey,
        ],
      );
      primaryRefundTxId = tx1Res.rows[0].id;
      primaryRefundStatus = tx1Res.rows[0].status || "SUCCESS";
      primaryRefundCreatedAt = tx1Res.rows[0].created_at;
    }

    if (excessToMainWallet > 0) {
      const mBefore = merchantCursorBalance;
      const mAfter = mBefore - excessToMainWallet;
      merchantCursorBalance = mAfter;
      const bAfter = buyerBefore + excessToMainWallet;

      await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
        bAfter,
        buyerUserId,
      ]);

      const tx2Snapshot = {
        ...baseSnapshot,
        postpaid_leg: "EXCESS_MAIN_WALLET",
      };
      const tx2Res = await client.query(
        `INSERT INTO transactions (
           transaction_type,
           source_user_id, source_balance_before, source_balance_after,
           destination_user_id, dest_balance_before, dest_balance_after,
           amount, user_fee, merchant_fee, fee_rate_snapshot,
           description, idempotency_key, status, linked_bank_account_id
         )
         VALUES ('REFUND', $1, $2, $3, $4, $5, $6, $7, 0, 0, $8::jsonb, $9, $10, 'SUCCESS', NULL)
         RETURNING id, status, created_at`,
        [
          merchantId,
          mBefore,
          mAfter,
          buyerUserId,
          buyerBefore,
          bAfter,
          excessToMainWallet,
          serializeFeeRateSnapshot(tx2Snapshot),
          `${refundNote}`,
          creditToReduce > 0 ? `${idempotencyKey}:excess` : idempotencyKey,
        ],
      );
      excessTxId = tx2Res.rows[0].id;
      if (!primaryRefundTxId) {
        primaryRefundTxId = excessTxId;
        primaryRefundStatus = tx2Res.rows[0].status || "SUCCESS";
        primaryRefundCreatedAt = tx2Res.rows[0].created_at;
      }
    }

    await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [
      merchantCursorBalance,
      merchantId,
    ]);

    await client.query(
      `UPDATE postpaid_wallets
          SET used_amount = $1,
              billed_amount = $2,
              status = $3,
              lock_reason = $4,
              due_date = CASE WHEN $5::boolean THEN NULL ELSE due_date END,
              overdue_cycle_month = CASE WHEN $5::boolean THEN NULL ELSE overdue_cycle_month END,
              overdue_cycle_due_date = CASE WHEN $5::boolean THEN NULL ELSE overdue_cycle_due_date END,
              overdue_cycle_principal = CASE WHEN $5::boolean THEN 0 ELSE overdue_cycle_principal END,
              updated_at = NOW()
        WHERE user_id = $6`,
      [newUsed, newBilled, newStatus, newLockReason, isClearingPastDueViaRefund, buyerUserId],
    );

    await client.query(
      `INSERT INTO postpaid_entries (
         id, user_id, tx_id, ref_tx_id, action, amount, delta_used,
         used_before, used_after, cycle_month, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        uuidv7(),
        buyerUserId,
        primaryRefundTxId,
        cleanTxId,
        refundAction,
        actualRefundAmount,
        -creditToReduce,
        oldUsed,
        newUsed,
        resolvedPurchaseEntry.cycle_month,
        refundNote,
      ],
    );

    await recordAudit(client, "POSTPAID_REFUND", {
      original_tx_id: cleanTxId,
      refund_tx_id: primaryRefundTxId,
      excess_tx_id: excessTxId,
      original_funding_source: "POSTPAID",
      buyer_user_id: buyerUserId,
      merchant_id: merchantId,
      refund_amount: actualRefundAmount,
      credited_to_postpaid: creditToReduce,
      credited_to_main_wallet: excessToMainWallet,
      used_before: oldUsed,
      used_after: newUsed,
      billed_after: newBilled,
    });

    await recordAudit(client, "ADMIN_OP_REVERSAL", {
      transaction_id: primaryRefundTxId,
      excess_transaction_id: excessTxId,
      original_transaction_id: cleanTxId,
      transaction_type: "REFUND",
      original_funding_source: "POSTPAID",
      status: primaryRefundStatus,
      source_user_id: merchantId,
      destination_user_id: buyerUserId,
      amount: actualRefundAmount,
      credited_to_postpaid: creditToReduce,
      credited_to_main_wallet: excessToMainWallet,
      postpaid_status: newStatus,
      fee: 0,
      merchant_fee: 0,
      fee_rate_snapshot: baseSnapshot,
      net_amount: actualRefundAmount,
      source_balance_before: merchantBefore,
      source_balance_after: merchantCursorBalance,
      dest_balance_before: buyerBefore,
      dest_balance_after: buyerBefore + excessToMainWallet,
      idempotency_key: idempotencyKey,
    });

    return {
      transactionId: String(primaryRefundTxId),
      excessTransactionId: excessTxId ? String(excessTxId) : null,
      status: primaryRefundStatus,
      createdAt: primaryRefundCreatedAt,
      amount: actualRefundAmount,
      fee: 0,
      merchantFee: 0,
      netAmount: actualRefundAmount,
      feeRateSnapshot: baseSnapshot,
      originalFundingSource: "POSTPAID",
      creditedToPostpaid: creditToReduce,
      creditedToMainWallet: excessToMainWallet,
      postpaidStatus: newStatus,
      usedAmountAfter: newUsed,
      billedAmountAfter: newBilled,
      description: refundNote,
      sourceUserId: merchantId,
      sourceUserName: merchantUser.full_name,
      destinationId: buyerUserId,
      destinationUserName: buyerUser.full_name,
      sourceBalanceBefore: merchantBefore,
      sourceBalanceAfter: merchantCursorBalance,
      destBalanceBefore: buyerBefore,
      destBalanceAfter: buyerBefore + excessToMainWallet,
    };
  },

  /**
   * Hoàn tiền một giao dịch thanh toán QR Ví trả sau (`PURCHASE`) về phía người mua:
   * - Bù trừ tối đa vào phần dư nợ gốc ví trả sau còn lại (`principalDebtRemaining`), trả tiền từ merchant về `SYSTEM_POSTPAID_WALLET`.
   * - Nếu người mua đã trả bớt nợ nên tiền hoàn vượt dư nợ gốc còn lại, phần dôi dư (`excessToMainWallet`) hoàn thẳng về ví chính.
   * - Cập nhật `used_amount` / `billed_amount`, ghi bút toán `REFUND` vào `postpaid_entries` và tự mở khóa ví nếu hết nợ quá hạn.
   */
  async refundPostpaidTransaction({
    originalTxId,
    refundAmount = null,
    reason = "",
    actorId = null,
    idempotencyKey = null,
  }) {
    if (!originalTxId || !String(originalTxId).trim()) {
      throw httpError(400, "Thiếu mã giao dịch gốc để hoàn tiền");
    }
    if (refundAmount !== null && refundAmount !== undefined) {
      throw httpError(
        400,
        "Nghiệp vụ chỉ hỗ trợ hoàn tiền 100% giá trị giao dịch qua luồng hoàn tiền thống nhất",
      );
    }
    const cleanTxId = String(originalTxId).trim();
    const effectiveIdemKey = idempotencyKey || `postpaid_refund_${uuidv7()}`;

    const client = await pool.connect();
    let resultPayload;

    try {
      await client.query("BEGIN");

      const txRes = await client.query(
        `SELECT id, transaction_type, source_user_id, destination_user_id, amount,
                merchant_fee, status, created_at
           FROM transactions
          WHERE id = $1
          FOR UPDATE`,
        [cleanTxId],
      );
      const txRow = txRes.rows[0];
      if (!txRow) {
        throw httpError(404, "Không tìm thấy giao dịch gốc");
      }

      const { entryActions } = await postpaidRepository.getSystemCatalog(client);
      const purchaseAction = requireCatalogCode(
        entryActions,
        "PURCHASE",
        ACTION_CATALOG_LABEL,
      );
      const purchaseRes = await client.query(
        `SELECT id, user_id, amount, cycle_month, created_at
           FROM postpaid_entries
          WHERE tx_id = $1 AND action = $2
          LIMIT 1`,
        [cleanTxId, purchaseAction],
      );
      const purchaseEntry = purchaseRes.rows[0];
      if (!purchaseEntry) {
        throw httpError(422, "Giao dịch này không phải giao dịch thanh toán bằng Ví trả sau");
      }

      const merchantId = txRow.destination_user_id;
      const buyerUserId = purchaseEntry.user_id;
      if (!merchantId) {
        throw httpError(422, "Giao dịch gốc không có tài khoản cửa hàng nhận tiền");
      }

      const usersMap = await lockUsersByIdsOrdered(client, [
        merchantId,
        buyerUserId,
      ]);
      const merchantUser = usersMap.get(String(merchantId));
      const buyerUser = usersMap.get(String(buyerUserId));

      const reversalRes = await postpaidRepository.executePostpaidReversalWithinTx(
        client,
        {
          txRow,
          purchaseEntry,
          merchantUser,
          buyerUser,
          reason,
          idempotencyKey: effectiveIdemKey,
        },
      );

      await client.query("COMMIT");

      resultPayload = {
        originalTransactionId: cleanTxId,
        refundTransactionId: reversalRes.transactionId,
        excessTransactionId: reversalRes.excessTransactionId,
        buyerUserId: String(buyerUserId),
        merchantId: String(merchantId),
        actorId: actorId || null,
        refundAmount: reversalRes.amount,
        creditedToPostpaid: reversalRes.creditedToPostpaid,
        creditedToMainWallet: reversalRes.creditedToMainWallet,
        usedAmountAfter: reversalRes.usedAmountAfter,
        billedAmountAfter: reversalRes.billedAmountAfter,
        postpaidStatus: reversalRes.postpaidStatus,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return resultPayload;
  },

  /**
   * Chốt sao kê theo từng lô (tối đa batchSize dòng mỗi transaction) vào hoặc sau ngày billing_day.
   */
  async closeBillingCycle({ nowMs = Date.now(), batchSize = 500, userId = null } = {}) {
    const [{ config, statuses, entryActions }] = await Promise.all([
      postpaidRepository.getSystemCatalog(pool),
      postpaidRepository.verifySystemPostpaidWallet(pool),
    ]);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const frozenStatus = requireCatalogCode(statuses, "FROZEN", STATUS_CATALOG_LABEL);
    const purchaseAction = requireCatalogCode(
      entryActions,
      "PURCHASE",
      ACTION_CATALOG_LABEL,
    );
    const serviceFeeAction = requireCatalogCode(
      entryActions,
      "SERVICE_FEE",
      ACTION_CATALOG_LABEL,
    );
    const statementCloseAction = requireCatalogCode(
      entryActions,
      "STATEMENT_CLOSE",
      ACTION_CATALOG_LABEL,
    );
    const vnMeta = getVnDateMeta(nowMs);
    if (!config.enabled || vnMeta.day < config.billing_day) {
      return { skipped: true, processed: 0, cycleMonth: vnMeta.cycleMonth };
    }

    const dueDateStr = buildDueDateStr(
      vnMeta.nextMonthYear,
      vnMeta.nextMonthNum,
      config.due_day,
    );
    const safeBatch = Math.min(Math.max(1, Number(batchSize) || 500), 1000);
    let totalProcessed = 0;

    while (true) {
      const client = await pool.connect();
      let batchCount = 0;

      try {
        await client.query("BEGIN");

        const batchRes = await client.query(
          `SELECT pw.user_id,
                  pw.status,
                  pw.due_date,
                  pw.overdue_cycle_due_date,
                  pw.used_amount,
                  pw.service_fee_amount,
                  pw.late_fee_amount,
                  EXISTS (
                    SELECT 1
                      FROM postpaid_entries pe
                     WHERE pe.user_id = pw.user_id
                       AND pe.action = $7
                    OFFSET $9::int
                     LIMIT 1
                  ) AS exceeds_free_service_fee_txs,
                  EXISTS (
                    SELECT 1
                      FROM postpaid_entries pe
                     WHERE pe.user_id = pw.user_id
                       AND pe.action = $7
                       AND NOT EXISTS (
                         SELECT 1
                           FROM postpaid_entries st
                          WHERE st.user_id = pw.user_id
                            AND st.action = $8
                            AND (
                              st.created_at > pe.created_at
                              OR (st.created_at = pe.created_at AND st.id >= pe.id)
                            )
                       )
                  ) AS has_cycle_purchase
             FROM postpaid_wallets pw
            WHERE pw.status IN ($3, $4, $5)
              AND ($10::uuid IS NULL OR pw.user_id = $10::uuid)
              AND (pw.current_cycle_month IS DISTINCT FROM $1)
              AND (
                (pw.used_amount - pw.service_fee_amount - pw.late_fee_amount) > 0
                OR (
                  $6::bigint > 0
                  AND EXISTS (
                    SELECT 1
                      FROM postpaid_entries pe
                     WHERE pe.user_id = pw.user_id
                       AND pe.action = $7
                       AND NOT EXISTS (
                         SELECT 1
                           FROM postpaid_entries st
                          WHERE st.user_id = pw.user_id
                            AND st.action = $8
                            AND (
                              st.created_at > pe.created_at
                              OR (st.created_at = pe.created_at AND st.id >= pe.id)
                            )
                       )
                  )
                  AND EXISTS (
                    SELECT 1
                      FROM postpaid_entries pe
                     WHERE pe.user_id = pw.user_id
                       AND pe.action = $7
                    OFFSET $9::int
                     LIMIT 1
                  )
                )
              )
            ORDER BY pw.user_id ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED`,
          [
            vnMeta.cycleMonth,
            safeBatch,
            activeStatus,
            pastDueStatus,
            frozenStatus,
            config.monthly_service_fee,
            purchaseAction,
            statementCloseAction,
            config.free_service_fee_tx_count,
            userId || null,
          ],
        );

        batchCount = batchRes.rows.length;
        if (batchCount === 0) {
          await client.query("ROLLBACK");
          break;
        }

        for (const row of batchRes.rows) {
          const usedBefore = Number(row.used_amount);
          const oldServiceFee = Number(row.service_fee_amount);
          const oldLateFee = Number(row.late_fee_amount);
          const exceedsFreeTxs = Boolean(row.exceeds_free_service_fee_txs);
          const hasCyclePurchase = Boolean(row.has_cycle_purchase);

          // Bắt buộc trừ service_fee_amount & late_fee_amount khỏi used_amount để billed_amount chỉ giữ phần gốc
          const newBilled = Math.max(0, usedBefore - oldServiceFee - oldLateFee);
          const qualifiesServiceFee =
            config.monthly_service_fee > 0 &&
            hasCyclePurchase &&
            exceedsFreeTxs;

          if (newBilled <= 0 && !qualifiesServiceFee) continue;

          // 1. Tránh chốt trùng 2 lần cùng kỳ nhờ kiểm tra và unique index (user_id, cycle_month)
          const existingStmtRes = await client.query(
            `SELECT 1
               FROM postpaid_entries
              WHERE user_id = $1
                AND cycle_month = $2
                AND action = $3
              LIMIT 1`,
            [row.user_id, vnMeta.cycleMonth, statementCloseAction],
          );
          if (existingStmtRes.rows[0]) continue;

          // 2. Thu phí dịch vụ tháng nếu kỳ này có giao dịch mới & đã vượt số giao dịch miễn phí đầu
          let serviceFeeAdded = 0;
          if (qualifiesServiceFee) {
            const feeInsert = await client.query(
              `INSERT INTO postpaid_entries (
                 id, user_id, action, amount, delta_used, used_before, used_after, cycle_month, note
               )
               VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8)
               ON CONFLICT (user_id, cycle_month) WHERE action = 'SERVICE_FEE'
               DO NOTHING
               RETURNING id`,
              [
                uuidv7(),
                row.user_id,
                serviceFeeAction,
                config.monthly_service_fee,
                usedBefore,
                usedBefore + config.monthly_service_fee,
                vnMeta.cycleMonth,
                `Phí dịch vụ Ví trả sau kỳ ${formatCycleMonthDisplay(vnMeta.cycleMonth)}`,
              ],
            );
            if (feeInsert.rows[0]) {
              serviceFeeAdded = config.monthly_service_fee;
            }
          }

          // 3. Ghi bút toán chốt sao kê STATEMENT_CLOSE (delta_used = 0) và cập nhật kỳ/hạn trả
          const usedAfterServiceFee = usedBefore + serviceFeeAdded;
          const stmtInsert = await client.query(
            `INSERT INTO postpaid_entries (
               id, user_id, action, amount, delta_used, used_before, used_after, cycle_month, note
             )
             VALUES ($1, $2, $3, $4, 0, $5, $5, $6, $7)
             ON CONFLICT (user_id, cycle_month) WHERE action = 'STATEMENT_CLOSE'
             DO NOTHING
             RETURNING id`,
            [
              uuidv7(),
              row.user_id,
              statementCloseAction,
              newBilled + serviceFeeAdded,
              usedAfterServiceFee,
              vnMeta.cycleMonth,
              `Chốt sao kê kỳ ${formatCycleMonthDisplay(vnMeta.cycleMonth)}`,
            ],
          );

          if (!stmtInsert.rows[0]) continue;

          // Bảo toàn ngày đáo hạn cũ nếu kỳ trước vẫn đang quá hạn (chống job chốt kỳ mới ghi đè due_date)
          const keepExistingDueDate =
            row.status === pastDueStatus || Boolean(row.overdue_cycle_due_date);
          const nextDueDate = keepExistingDueDate
            ? toYmdStr(row.overdue_cycle_due_date || row.due_date) || dueDateStr
            : dueDateStr;

          await client.query(
            `UPDATE postpaid_wallets
                SET billed_amount = $1,
                    service_fee_amount = $2,
                    used_amount = $3,
                    current_cycle_month = $4,
                    due_date = $5::date,
                    updated_at = NOW()
              WHERE user_id = $6`,
            [
              newBilled,
              oldServiceFee + serviceFeeAdded,
              usedAfterServiceFee,
              vnMeta.cycleMonth,
              nextDueDate,
              row.user_id,
            ],
          );
          totalProcessed += 1;
        }

        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      if (batchCount < safeBatch) break;
    }

    return {
      skipped: false,
      processed: totalProcessed,
      cycleMonth: vnMeta.cycleMonth,
      dueDate: dueDateStr,
    };
  },

  /**
   * Đánh dấu quá hạn & ghi nhận công nợ phí trễ hạn theo từng lô batchSize dòng.
   */
  async markOverdueAndApplyLateFees({ nowMs = Date.now(), batchSize = 500, userId = null } = {}) {
    const [{ config, statuses, entryActions }] = await Promise.all([
      postpaidRepository.getSystemCatalog(pool),
      postpaidRepository.verifySystemPostpaidWallet(pool),
    ]);
    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const frozenStatus = requireCatalogCode(statuses, "FROZEN", STATUS_CATALOG_LABEL);
    const lateFeeAction = requireCatalogCode(
      entryActions,
      "LATE_FEE",
      ACTION_CATALOG_LABEL,
    );
    if (!config.enabled) {
      return { skipped: true, processed: 0 };
    }

    const vnMeta = getVnDateMeta(nowMs);
    const safeBatch = Math.min(Math.max(1, Number(batchSize) || 500), 1000);
    let totalProcessed = 0;

    while (true) {
      const client = await pool.connect();
      let batchCount = 0;

      try {
        await client.query("BEGIN");

        const batchRes = await client.query(
          `SELECT user_id, status, lock_reason, overdue_count, last_overdue_counted_cycle,
                  overdue_cycle_month, overdue_cycle_due_date, overdue_cycle_principal,
                  used_amount, billed_amount, service_fee_amount,
                  late_fee_amount, current_cycle_month, due_date
             FROM postpaid_wallets
            WHERE status IN ($3, $4, $5)
              AND ($6::uuid IS NULL OR user_id = $6::uuid)
              AND (billed_amount + service_fee_amount) > 0
              AND COALESCE(overdue_cycle_due_date, due_date) IS NOT NULL
              AND COALESCE(overdue_cycle_due_date, due_date) < $1::date
            ORDER BY user_id ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED`,
          [vnMeta.todayDateStr, safeBatch, activeStatus, frozenStatus, pastDueStatus, userId || null],
        );

        batchCount = batchRes.rows.length;
        if (batchCount === 0) {
          await client.query("ROLLBACK");
          break;
        }

        for (const row of batchRes.rows) {
          // 1. Xác định kỳ quá hạn hiệu lực, hạn trả gốc và bậc phí theo số ngày trễ thực tế
          const usedBefore = Number(row.used_amount);
          const billed = Number(row.billed_amount);
          const serviceFee = Number(row.service_fee_amount);
          const oldLateFee = Number(row.late_fee_amount);
          const effectiveCycle =
            row.overdue_cycle_month || row.current_cycle_month || vnMeta.cycleMonth;
          const effectiveDueDate = toYmdStr(row.overdue_cycle_due_date || row.due_date);
          const daysOverdue = diffDaysYmd(vnMeta.todayDateStr, effectiveDueDate);
          const tierSpec = resolvePostpaidLateFeeTier(daysOverdue, config);
          if (!tierSpec) continue;

          // 2. Nếu là kỳ mới chưa từng đếm -> tăng overdue_count +1 và chụp snapshot overdue_cycle_principal
          const isNewOverdueCycle = row.last_overdue_counted_cycle !== effectiveCycle;
          const nextOverdueCount = Number(row.overdue_count || 0) + (isNewOverdueCycle ? 1 : 0);
          const snapshotPrincipal = isNewOverdueCycle
            ? billed
            : (Number(row.overdue_cycle_principal || 0) > 0
              ? Number(row.overdue_cycle_principal)
              : billed);
          const nextRowStatus = row.status === frozenStatus ? frozenStatus : pastDueStatus;

          // 3. Tính mức phí trễ theo bậc hiện tại và chỉ thu bù phần chênh lệch so với các bậc đã thu trước đó
          const existingFeesRes = await client.query(
            `SELECT COALESCE(SUM(amount), 0)::bigint AS total_charged,
                    BOOL_OR(late_fee_tier = $3) AS tier_exists
               FROM postpaid_entries
              WHERE user_id = $1
                AND cycle_month = $2
                AND action = $4`,
            [row.user_id, effectiveCycle, tierSpec.tier, lateFeeAction],
          );
          const alreadyCharged = Number(existingFeesRes.rows[0]?.total_charged || 0);
          const tierAlreadyExists = Boolean(existingFeesRes.rows[0]?.tier_exists);

          const overdueBasis = billed + serviceFee;
          const targetFee = Math.round((overdueBasis * tierSpec.bps) / 10000);
          const deltaPenalty = Math.max(0, targetFee - alreadyCharged);

          let appliedDelta = 0;
          if (!tierAlreadyExists && deltaPenalty > 0) {
            const feeInsert = await client.query(
              `INSERT INTO postpaid_entries (
                 id, user_id, action, amount, delta_used, used_before, used_after,
                 cycle_month, late_fee_tier, note
               )
               VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (user_id, cycle_month, late_fee_tier) WHERE action = 'LATE_FEE'
               DO NOTHING
               RETURNING id`,
              [
                uuidv7(),
                row.user_id,
                lateFeeAction,
                deltaPenalty,
                usedBefore,
                usedBefore + deltaPenalty,
                effectiveCycle,
                tierSpec.tier,
                `Phí chậm trả bậc ${tierSpec.tier} (${tierSpec.label}) kỳ ${formatCycleMonthDisplay(effectiveCycle)}`,
              ],
            );
            if (feeInsert.rows[0]) {
              appliedDelta = deltaPenalty;
            }
          }

          const shouldUpdateWallet =
            appliedDelta > 0 ||
            isNewOverdueCycle ||
            row.status !== nextRowStatus ||
            !row.overdue_cycle_month ||
            !row.overdue_cycle_due_date;

          if (shouldUpdateWallet) {
            await client.query(
              `UPDATE postpaid_wallets
                  SET status = $1,
                      late_fee_amount = $2,
                      used_amount = $3,
                      overdue_count = $4,
                      last_overdue_counted_cycle = $5,
                      overdue_cycle_month = $6,
                      overdue_cycle_due_date = $7::date,
                      overdue_cycle_principal = $8,
                      updated_at = NOW()
                WHERE user_id = $9`,
              [
                nextRowStatus,
                oldLateFee + appliedDelta,
                usedBefore + appliedDelta,
                nextOverdueCount,
                effectiveCycle,
                effectiveCycle,
                effectiveDueDate,
                snapshotPrincipal,
                row.user_id,
              ],
            );
            totalProcessed += 1;
          }
        }

        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      if (batchCount < safeBatch) break;
    }

    return {
      skipped: false,
      processed: totalProcessed,
      todayDate: vnMeta.todayDateStr,
    };
  },

  /**
   * Khóa và đánh dấu theo từng lô các ví trả sau còn dư nợ chưa nhắc trong tháng `reminderMonth` (`YYYY-MM`).
   * Cập nhật `last_reminder_month` ngay khi claim để chống gửi trùng giữa các worker hoặc khi restart server.
   */
  async claimMonthlyDebtReminderBatch(
    { reminderMonth, batchSize = 500, requireFcmToken = true } = {},
    db = pool,
  ) {
    const cleanMonth = String(reminderMonth || "").trim();
    if (!/^\d{4}-\d{2}$/.test(cleanMonth)) {
      throw new Error("reminderMonth phải có định dạng YYYY-MM");
    }

    const [catalog, reminderConfig] = await Promise.all([
      postpaidRepository.getSystemCatalog(db),
      postpaidRepository.getReminderConfig(db),
    ]);
    const { config, statuses } = catalog;
    if (!config.enabled) {
      return { skipped: true, reason: "POSTPAID_DISABLED", rows: [], reminderConfig };
    }
    if (!reminderConfig.enabled) {
      return { skipped: true, reason: "REMINDER_DISABLED", rows: [], reminderConfig };
    }

    const activeStatus = requireCatalogCode(statuses, "ACTIVE", STATUS_CATALOG_LABEL);
    const pastDueStatus = requireCatalogCode(statuses, "PAST_DUE", STATUS_CATALOG_LABEL);
    const frozenStatus = requireCatalogCode(statuses, "FROZEN", STATUS_CATALOG_LABEL);
    const safeBatch = Math.min(Math.max(1, Number(batchSize) || 500), 1000);

    const useOwnClient = typeof db.connect === "function";
    const client = useOwnClient ? await db.connect() : db;
    let claimedRows = [];

    try {
      if (useOwnClient) {
        await client.query("BEGIN");
      }

      const claimRes = await client.query(
        `WITH picked AS (
           SELECT pw.user_id
             FROM postpaid_wallets pw
             JOIN users u ON u.id = pw.user_id
            WHERE pw.status IN ($2, $3, $4)
              AND pw.used_amount > 0
              AND pw.last_reminder_month IS DISTINCT FROM $1
              AND u.role = 'USER'
              AND u.status = 'ACTIVE'
              AND ($6::boolean = false OR (u.fcm_token IS NOT NULL AND BTRIM(u.fcm_token) <> ''))
            ORDER BY pw.user_id ASC
            LIMIT $5
            FOR UPDATE OF pw SKIP LOCKED
         )
         UPDATE postpaid_wallets pw
            SET last_reminder_month = $1,
                updated_at = NOW()
           FROM picked
           JOIN users u ON u.id = picked.user_id
          WHERE pw.user_id = picked.user_id
          RETURNING pw.user_id,
                    pw.status,
                    pw.used_amount,
                    pw.billed_amount,
                    pw.service_fee_amount,
                    pw.late_fee_amount,
                    pw.current_cycle_month,
                    TO_CHAR(pw.due_date, 'YYYY-MM-DD') AS due_date_str,
                    u.full_name,
                    u.fcm_token`,
        [
          cleanMonth,
          activeStatus,
          pastDueStatus,
          frozenStatus,
          safeBatch,
          Boolean(requireFcmToken),
        ],
      );

      claimedRows = claimRes.rows;

      if (claimedRows.length > 0) {
        await client.query(
          `INSERT INTO audit_outbox (id, event_type, payload)
           SELECT t.id, 'POSTPAID_MONTHLY_REMINDER_SENT', t.payload
             FROM unnest($1::uuid[], $2::jsonb[]) AS t(id, payload)`,
          [
            claimedRows.map(() => uuidv7()),
            claimedRows.map((row) =>
              JSON.stringify({
                user_id: row.user_id,
                reminder_month: cleanMonth,
                status: row.status,
                used_amount: Number(row.used_amount),
                billed_amount: Number(row.billed_amount),
                service_fee_amount: Number(row.service_fee_amount),
                late_fee_amount: Number(row.late_fee_amount),
                due_date: row.due_date_str || null,
              }),
            ),
          ],
        );
      }

      if (useOwnClient) {
        await client.query("COMMIT");
      }
    } catch (e) {
      if (useOwnClient) {
        await client.query("ROLLBACK");
      }
      throw e;
    } finally {
      if (useOwnClient && typeof client.release === "function") {
        client.release();
      }
    }

    return {
      skipped: false,
      rows: claimedRows,
      reminderConfig,
    };
  },

  /**
   * User gửi yêu cầu mở khóa Ví trả sau khi bị khóa `FROZEN` do quá hạn lặp lại (`OVERDUE_REPEAT`):
   * - Bắt buộc kèm 1–3 ảnh chứng minh thu nhập, đã tất toán sạch dư nợ kỳ sao kê và chưa có đơn `PENDING`.
   * - Lưu snapshot `overdue_count` và `credit_limit` vào `postpaid_unlock_requests` để Admin xét duyệt.
   */
  async createUnlockRequest({ userId, userNote = "", proofFileNames = [] }) {
    if (!Array.isArray(proofFileNames) || proofFileNames.length === 0 || proofFileNames.length > 3) {
      throw httpError(400, "Vui lòng gửi từ 1 đến 3 ảnh chứng minh thu nhập");
    }
    const cleanNote =
      typeof userNote === "string" && userNote.trim()
        ? userNote.trim().slice(0, 500)
        : null;

    const { statuses } = await postpaidRepository.getSystemCatalog(pool);
    const frozenStatus = requireCatalogCode(statuses, "FROZEN", STATUS_CATALOG_LABEL);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const usersMap = await lockUsersByIdsOrdered(client, [userId]);
      const user = usersMap.get(String(userId));
      if (!user) {
        throw httpError(404, "Không tìm thấy người dùng");
      }
      if (user.status !== "ACTIVE" || user.role !== "USER") {
        throw httpError(403, "Tài khoản không khả dụng");
      }

      const pwRes = await client.query(
        `SELECT user_id, status, lock_reason, overdue_count, credit_limit,
                used_amount, billed_amount, service_fee_amount, late_fee_amount
           FROM postpaid_wallets
          WHERE user_id = $1
          FOR UPDATE`,
        [userId],
      );
      const pw = pwRes.rows[0] || null;
      if (!pw) {
        throw httpError(404, "Bạn chưa kích hoạt Ví trả sau");
      }
      if (pw.status !== frozenStatus || pw.lock_reason !== "OVERDUE_REPEAT") {
        throw httpError(
          400,
          "Chỉ áp dụng gửi hồ sơ chứng minh thu nhập khi ví đang bị khóa do quá hạn lặp lại",
        );
      }
      if (
        Number(pw.billed_amount) > 0 ||
        Number(pw.service_fee_amount) > 0 ||
        Number(pw.late_fee_amount) > 0
      ) {
        throw httpError(400, "Vui lòng tất toán hết dư nợ quá hạn trước khi gửi yêu cầu mở khóa");
      }

      const pendingRes = await client.query(
        `SELECT id FROM postpaid_unlock_requests WHERE user_id = $1 AND status = 'PENDING' LIMIT 1`,
        [userId],
      );
      if (pendingRes.rows[0]) {
        throw httpError(409, "Bạn đang có yêu cầu mở khóa chờ xét duyệt");
      }

      const reqId = uuidv7();
      const insertRes = await client.query(
        `INSERT INTO postpaid_unlock_requests (
           id, user_id, status, user_note, proof_image_paths,
           overdue_count_snapshot, credit_limit_snapshot
         )
         VALUES ($1, $2, 'PENDING', $3, $4::jsonb, $5, $6)
         RETURNING id, user_id, status, user_note, proof_image_paths,
                   overdue_count_snapshot, credit_limit_snapshot,
                   admin_note, reviewed_at, created_at, updated_at`,
        [
          reqId,
          userId,
          cleanNote,
          JSON.stringify(proofFileNames),
          Number(pw.overdue_count || 0),
          Number(pw.credit_limit || 0),
        ],
      );

      await recordAudit(client, "POSTPAID_UNLOCK_REQUEST_SUBMITTED", {
        user_id: userId,
        request_id: reqId,
        proof_count: proofFileNames.length,
      });

      await client.query("COMMIT");
      const created = insertRes.rows[0];
      return {
        id: created.id,
        user_id: created.user_id,
        status: created.status,
        user_note: created.user_note,
        proof_count: Array.isArray(created.proof_image_paths)
          ? created.proof_image_paths.length
          : proofFileNames.length,
        overdue_count_snapshot: Number(created.overdue_count_snapshot || 0),
        credit_limit_snapshot: Number(created.credit_limit_snapshot || 0),
        admin_note: created.admin_note,
        reviewed_at: created.reviewed_at,
        created_at: created.created_at,
        updated_at: created.updated_at,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      if (e && e.code === "23505") {
        throw httpError(409, "Bạn đang có yêu cầu mở khóa chờ xét duyệt");
      }
      throw e;
    } finally {
      client.release();
    }
  },

  /** Lấy yêu cầu mở khóa Ví trả sau (`postpaid_unlock_requests`) mới nhất của một người dùng. */
  async getLatestUnlockRequest(userId, db = pool) {
    const res = await db.query(
      `SELECT id, user_id, status, user_note, proof_image_paths,
              overdue_count_snapshot, credit_limit_snapshot,
              admin_note, reviewed_at, created_at, updated_at
         FROM postpaid_unlock_requests
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    );
    const row = res.rows[0] || null;
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      status: row.status,
      user_note: row.user_note,
      proof_count: Array.isArray(row.proof_image_paths)
        ? row.proof_image_paths.length
        : 0,
      overdue_count_snapshot: Number(row.overdue_count_snapshot || 0),
      credit_limit_snapshot: Number(row.credit_limit_snapshot || 0),
      admin_note: row.admin_note,
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },

  getVnDateMeta,
  toYmdStr,
  diffDaysYmd,
  computeAutoAdjustedCreditLimit,
  formatCycleMonthDisplay,
  normalizePostpaidConfig,
  normalizePostpaidReminderConfig,
  buildMonthlyDebtReminderNotification,
};

module.exports = postpaidRepository;

