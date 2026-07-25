const pool = require('../../config/database');

const walletRepository = {
    async getWalletBalanceByUserId(userId){
        const result = await pool.query(`SELECT w.user_id, wb.balance
            FROM wallets w
            LEFT JOIN wallet_balances wb
            ON w.id = wb.wallet_id
            WHERE w.user_id = $1
            `, [userId]);
        return result.rows[0];
    }
}

module.exports = walletRepository;