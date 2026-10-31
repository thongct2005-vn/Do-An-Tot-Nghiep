const merchantBankRepository = require("./bank.repository");
const userRepository = require("../../../../modules/user/user.repository");
const { uuidv7 } = require("uuidv7");
const { httpError } = require("../../../../utils/httpError");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const merchantBankService = {
  async getBankLinkStatus(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    const [allBanks, linkedAccounts] = await Promise.all([
      merchantBankRepository.getAllActiveBanks(),
      merchantBankRepository.getLinkedAccountsByUserId(userId),
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
    const { full_name: accountHolderName, phone: accountNumber } =
      await userRepository.getUserByUserId(userId);
    const id = uuidv7();
    await merchantBankRepository.linkBankAccount({
      id,
      userId,
      bankId,
      accountNumber,
      accountHolderName,
    });
  },

  async getLinkedAccountBalance({ userId, linkedBankAccountId }) {
    if (!userId || !linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin để lấy số dư ngân hàng");
    }

    if (!UUID_PATTERN.test(linkedBankAccountId)) {
      throw httpError(400, "Mã ngân hàng liên kết không hợp lệ");
    }

    const account = await merchantBankRepository.getLinkedAccountBalance(
      userId,
      linkedBankAccountId,
    );
    if (!account) {
      throw httpError(404, "Không tìm thấy ngân hàng liên kết");
    }

    return {
      linked_bank_account_id: account.id,
      bank_name: account.bank_name,
      balance: Number(account.balance),
    };
  },
};

module.exports = merchantBankService;
