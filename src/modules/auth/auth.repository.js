const pool = require('../../config/database');
 const authRepository = {
    findUserByPhone: async (phone)=>{
        const result = await pool.query(`
            SELECT id, phone, email, password_hash, failed_login_attempts, locked_until
            FROM users
            WHERE phone = $1
            `, [phone]
            );
        return result.rows[0];
    },

    resetFailedLogin: async (phone) =>{
        await pool.query(`
            UPDATE users
            SET failed_login_attempts = 0, locked_until = NULL
            WHERE phone = $1
            `, [phone]
        );
    },


    updateFailedLogin: async (phone, attempts, lockMinutes = 0)=>{
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
    }
 }

 module.exports = authRepository