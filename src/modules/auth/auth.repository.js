const pool = require('../../config/database');
const { register } = require('./auth.service');
 const authRepository = {
    findUserByPhone: async (phone) => {
        const result = await pool.query(`
            SELECT id, phone, email, password_hash, failed_login_attempts, locked_until, (locked_until > NOW()) AS is_locked
            FROM users
            WHERE phone = $1
            `, [phone]
            );
        return result.rows[0];
    },

    resetFailedLogin: async (phone) => {
        await pool.query(`
            UPDATE users
            SET failed_login_attempts = 0, locked_until = NULL
            WHERE phone = $1
            `, [phone]
        );
    },

    updateFailedLogin: async (phone, attempts, lockMinutes = 0) => {
        await pool.query(`
            UPDATE users
            SET failed_login_attempts = $2,
            locked_until = CASE
            WHEN $3::INT > 0 THEN NOW() + ($3::TEXT || ' minutes'):: INTERVAL
                ELSE locked_until
            END
            WHERE phone = $1
            `, [phone, attempts, lockMinutes]
        );
    },

    addUser: async (userId, walletId, phone, passwordHash)=>{
        const client = await pool.connect();
        try{
            await client.query('BEGIN');

            await client.query(`
            INSERT INTO users(id, phone, password_hash)
            VALUES ($1, $2, $3)
            `, [userId, phone, passwordHash]);

            await client.query(`
            INSERT INTO wallets(id, user_id)
            VALUES ($1, $2)
            `, [walletId, userId]);

            await client.query(`
            INSERT INTO wallet_balances(wallet_id)
            VALUES ($1)
            `, [walletId]);

            await client.query('COMMIT');
        }
        catch(e){
            await client.query('ROLLBACK');
            throw e
        }
        finally{
            client.release();
        }
    },

 }

 module.exports = authRepository