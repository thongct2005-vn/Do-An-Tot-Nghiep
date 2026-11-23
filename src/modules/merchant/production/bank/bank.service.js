// bank.service.js: Nghiệp vụ liên kết ngân hàng, bật/ẩn số dư và lấy số dư chi tiết cho Merchant.
const merchantBankRepository = require("./bank.repository");
const userRepository = require("../../../../modules/user/user.repository");
const { httpError } = require("../../../../utils/common/http");
const { isValidUuid } = require("../../../../utils/common/validators");
const {
  createSharedBankService,
} = require("../../../bank/bank.helpers");

const sharedService = createSharedBankService({
  bankRepository: merchantBankRepository,
  userRepository,
});

const merchantBankService = {
  ...sharedService,

  async enableShowBalance({ userId, linkedBankAccountId }) {
    const updated = await sharedService.enableShowBalance({
      userId,
      linkedBankAccountId,
    });
    return {
      id: updated.id,
      is_show_balance: Boolean(updated.is_show_balance),
      balance: Number(updated.balance),
    };
  },

  async getLinkedAccountBalance({ userId, linkedBankAccountId }) {
    if (!userId || !linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin để lấy số dư ngân hàng");
    }

    if (!isValidUuid(linkedBankAccountId)) {
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
