const pool = require("../../config/database");

const bankRepository = {
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
    VALUES ($1, $2, $3, $4, $5)
        `,
      [id, userId, bankId, accountNumber, accountHolderName],
    );
  },

  async enableShowBalance({ userId, linkedBankAccountId }) {
    const result = await pool.query(
      `UPDATE linked_bank_accounts
       SET is_show_balance = true,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'
       RETURNING id, is_show_balance, balance`,
      [linkedBankAccountId, userId],
    );
    return result.rows[0] ?? null;
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

module.exports = bankRepository;
