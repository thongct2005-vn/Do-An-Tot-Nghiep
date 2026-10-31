const pool = require("../../../../config/database");

const walletRepository = {
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

  async updateWalletBalance({ phone, amount }) {
    await pool.query(`UPDATE users SET balance = $1 WHERE phone = $2`, [
      amount,
      phone,
    ]);
  },
};

module.exports = walletRepository;
