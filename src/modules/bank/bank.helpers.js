// bank.helpers.js: Các hàm dựng repository, service, controller và kiểm tra tham số ngân hàng liên kết dùng chung cho User và Merchant.
const { uuidv7 } = require("uuidv7");
const { successResponse, httpError } = require("../../utils/common/http");
const { isValidUuid } = require("../../utils/common/validators");

function assertValidLinkedBankParams(userId, linkedBankAccountId) {
  if (!userId || !linkedBankAccountId) {
    throw httpError(400, "Thiếu thông tin tài khoản ngân hàng liên kết");
  }
  if (!isValidUuid(linkedBankAccountId)) {
    throw httpError(400, "Mã ngân hàng liên kết không hợp lệ");
  }
}

function createSharedBankRepository(pool) {
  return {
    async getAllActiveBanks() {
      const result = await pool.query(
        `SELECT id, code, name, logo_url FROM banks WHERE is_active = true ORDER BY name`,
      );
      return result.rows;
    },

    async getLinkedAccountsByUserId(userId) {
      const result = await pool.query(
        `SELECT lba.id, lba.account_number, lba.account_holder_name, lba.is_default, lba.status,
                COALESCE(lba.is_show_balance, false) AS is_show_balance,
                CASE
                  WHEN COALESCE(lba.is_show_balance, false) = true THEN lba.balance
                  ELSE NULL
                END AS balance,
                b.id AS bank_id, b.code AS bank_code, b.name AS bank_name, b.logo_url
         FROM linked_bank_accounts lba
         JOIN banks b ON b.id = lba.bank_id
         WHERE lba.user_id = $1 AND lba.status = 'ACTIVE'
         ORDER BY lba.is_default DESC, lba.created_at DESC`,
        [userId],
      );
      return result.rows;
    },

    async findExistingLinkedAccount({ userId, bankId }) {
      const result = await pool.query(
        `SELECT id, status FROM linked_bank_accounts
         WHERE user_id = $1 AND bank_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, bankId],
      );
      return result.rows[0] ?? null;
    },

    async reactivateLinkedAccount(id) {
      const result = await pool.query(
        `UPDATE linked_bank_accounts
         SET status = 'ACTIVE',
             is_show_balance = false,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [id],
      );
      return result.rows[0] ?? null;
    },

    async linkBankAccount({
      id,
      userId,
      bankId,
      accountNumber,
      accountHolderName,
    }) {
      await pool.query(
        `INSERT INTO linked_bank_accounts
          (id, user_id, bank_id, account_number, account_holder_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, userId, bankId, accountNumber, accountHolderName],
      );
    },

    async setShowBalanceVisibility({
      userId,
      linkedBankAccountId,
      isShowBalance,
    }) {
      const show = Boolean(isShowBalance);
      const result = await pool.query(
        `UPDATE linked_bank_accounts
         SET is_show_balance = $3,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'
         RETURNING id,
                   is_show_balance,
                   CASE WHEN is_show_balance = true THEN balance ELSE NULL END AS balance`,
        [linkedBankAccountId, userId, show],
      );
      return result.rows[0] ?? null;
    },

    async enableShowBalance({ userId, linkedBankAccountId }) {
      return this.setShowBalanceVisibility({
        userId,
        linkedBankAccountId,
        isShowBalance: true,
      });
    },

    async hideBalance({ userId, linkedBankAccountId }) {
      return this.setShowBalanceVisibility({
        userId,
        linkedBankAccountId,
        isShowBalance: false,
      });
    },

    async unlinkBankAccount({ userId, linkedBankAccountId }) {
      const result = await pool.query(
        `UPDATE linked_bank_accounts
         SET status = 'UNLINKED',
             is_show_balance = false,
             is_default = false,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'
         RETURNING id`,
        [linkedBankAccountId, userId],
      );
      return result.rows[0] ?? null;
    },
  };
}

function createSharedBankService({ bankRepository, userRepository }) {
  return {
    async getBankLinkStatus(userId) {
      if (!userId) {
        throw httpError(400, "Thiếu thông tin người dùng");
      }

      const [allBanks, linkedAccounts] = await Promise.all([
        bankRepository.getAllActiveBanks(),
        bankRepository.getLinkedAccountsByUserId(userId),
      ]);

      const linkedBankIds = new Set(linkedAccounts.map((acc) => acc.bank_id));

      const banksWithStatus = allBanks.map((bank) => ({
        ...bank,
        is_linked: linkedBankIds.has(bank.id),
      }));

      return {
        has_linked_account: linkedAccounts.length > 0,
        linked_accounts: linkedAccounts,
        available_banks: banksWithStatus,
      };
    },

    async linkBankAccount({ userId, bankId }) {
      if (!userId || !bankId) {
        throw httpError(
          400,
          "Thiếu thông tin người dùng hoặc ngân hàng muốn liên kết",
        );
      }
      const existing = await bankRepository.findExistingLinkedAccount({
        userId,
        bankId,
      });
      if (existing) {
        if (existing.status === "ACTIVE") {
          throw httpError(409, "Ngân hàng này đã được liên kết");
        }
        await bankRepository.reactivateLinkedAccount(existing.id);
        return;
      }

      const { full_name: accountHolderName, phone: accountNumber } =
        await userRepository.getUserByUserId(userId);
      const id = uuidv7();
      await bankRepository.linkBankAccount({
        id,
        userId,
        bankId,
        accountNumber,
        accountHolderName,
      });
    },

    async enableShowBalance({ userId, linkedBankAccountId }) {
      assertValidLinkedBankParams(userId, linkedBankAccountId);
      const updated = await bankRepository.enableShowBalance({
        userId,
        linkedBankAccountId,
      });
      if (!updated) {
        throw httpError(404, "Không tìm thấy ngân hàng liên kết");
      }
      return updated;
    },

    async hideBalance({ userId, linkedBankAccountId }) {
      assertValidLinkedBankParams(userId, linkedBankAccountId);
      const updated = await bankRepository.hideBalance({
        userId,
        linkedBankAccountId,
      });
      if (!updated) {
        throw httpError(404, "Không tìm thấy ngân hàng liên kết");
      }
      return {
        id: updated.id,
        is_show_balance: Boolean(updated.is_show_balance),
      };
    },

    async unlinkBankAccount({ userId, linkedBankAccountId }) {
      assertValidLinkedBankParams(userId, linkedBankAccountId);
      const unlinked = await bankRepository.unlinkBankAccount({
        userId,
        linkedBankAccountId,
      });
      if (!unlinked) {
        throw httpError(404, "Không tìm thấy ngân hàng liên kết");
      }
      return unlinked;
    },
  };
}

function createSharedBankController(bankService) {
  return {
    async getBankLinkStatus(req, res, next) {
      try {
        const { user_id: userId } = req.user;
        const result = await bankService.getBankLinkStatus(userId);
        return successResponse(
          res,
          200,
          "Lấy danh danh ngân hàng đã liên kết thành công",
          result,
        );
      } catch (e) {
        next(e);
      }
    },

    async linkBankAccount(req, res, next) {
      try {
        const { user_id: userId } = req.user;
        const { bank_id: bankId } = req.body;
        await bankService.linkBankAccount({ userId, bankId });
        return successResponse(res, 200, "Liên kết ngân hàng thành công");
      } catch (e) {
        next(e);
      }
    },

    async enableShowBalance(req, res, next) {
      try {
        const { user_id: userId } = req.user;
        const { linked_bank_account_id: linkedBankAccountId } = req.body || {};
        const result = await bankService.enableShowBalance({
          userId,
          linkedBankAccountId,
        });
        return successResponse(
          res,
          200,
          "Đã bật hiển thị số dư ngân hàng",
          result,
        );
      } catch (e) {
        next(e);
      }
    },

    async hideBalance(req, res, next) {
      try {
        const { user_id: userId } = req.user;
        const { linked_bank_account_id: linkedBankAccountId } = req.body || {};
        const result = await bankService.hideBalance({
          userId,
          linkedBankAccountId,
        });
        return successResponse(res, 200, "Đã ẩn số dư ngân hàng", result);
      } catch (e) {
        next(e);
      }
    },

    async unlinkBankAccount(req, res, next) {
      try {
        const { user_id: userId } = req.user;
        const { linked_bank_account_id: linkedBankAccountId } = req.body;
        await bankService.unlinkBankAccount({
          userId,
          linkedBankAccountId,
        });
        return successResponse(res, 200, "Hủy liên kết ngân hàng thành công");
      } catch (e) {
        next(e);
      }
    },
  };
}

module.exports = {
  assertValidLinkedBankParams,
  createSharedBankRepository,
  createSharedBankService,
  createSharedBankController,
};

