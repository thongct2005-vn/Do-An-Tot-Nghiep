const pool = require("../../../../config/database");

const merchantWalletRepository = {
  async getWalletBalanceByUserId(userId) {
    const result = await pool.query(
      `SELECT u.balance, u.id
            FROM users u
            WHERE u.id = $1
            `,
      [userId],
    );
    return result.rows[0];
  },
};

module.exports = merchantWalletRepository;
