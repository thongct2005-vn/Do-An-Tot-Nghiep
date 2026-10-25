const pool = require("../../../../config/database");

const merchantBankRepository = {
  async getAllActiveBanks() {
    const result = await pool.query(
      `SELECT id, code, name, logo_url FROM banks WHERE is_active = true ORDER BY name`,
    );
    return result.rows;
  },

  async getLinkedAccountsByUserId(userId) {
    const result = await pool.query(
      `SELECT lba.id, lba.account_number, lba.account_holder_name, lba.is_default, lba.status,
              b.id AS bank_id, b.code AS bank_code, b.name AS bank_name, b.logo_url
       FROM linked_bank_accounts lba
       JOIN banks b ON b.id = lba.bank_id
       WHERE lba.user_id = $1 AND lba.status = 'ACTIVE'
       ORDER BY lba.is_default DESC, lba.created_at DESC`,
      [userId],
    );
    return result.rows;
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
    VALUES ($1, $2, $3, $4, $5)
        `,
      [id, userId, bankId, accountNumber, accountHolderName],
    );
  },

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