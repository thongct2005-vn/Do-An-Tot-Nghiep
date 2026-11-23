// bank.repository.js: Truy vấn danh sách ngân hàng, liên kết và số dư tài khoản ngân hàng của Merchant.
const pool = require("../../../../config/database");
const { createSharedBankRepository } = require("../../../bank/bank.helpers");

const merchantBankRepository = {
  ...createSharedBankRepository(pool),

  async getLinkedAccountBalance(userId, linkedBankAccountId) {
    const result = await pool.query(
      `SELECT lba.id, lba.balance, b.name AS bank_name
       FROM linked_bank_accounts lba
       JOIN banks b ON b.id = lba.bank_id
       WHERE lba.id = $1 AND lba.user_id = $2 AND lba.status = 'ACTIVE'`,
      [linkedBankAccountId, userId],
    );
    return result.rows[0];
  },
};

module.exports = merchantBankRepository;
