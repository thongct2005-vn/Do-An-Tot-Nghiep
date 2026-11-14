const bankRepository = require("./bank.repository");
const userRepository = require("../user/user.repository");
const { uuidv7 } = require("uuidv7");
const { httpError } = require("../../utils/httpError");
const bankService = {
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
    if (!userId || !linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin tài khoản ngân hàng liên kết");
    }
    const updated = await bankRepository.enableShowBalance({
      userId,
      linkedBankAccountId,
    });
    if (!updated) {
      throw httpError(404, "Không tìm thấy ngân hàng liên kết");
    }
    return updated;
  },

  async unlinkBankAccount({ userId, linkedBankAccountId }) {
    if (!userId || !linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin tài khoản ngân hàng liên kết");
    }
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

module.exports = bankService;
