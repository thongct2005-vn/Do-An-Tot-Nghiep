const pool = require("../../../../config/database");
const merchantAuthRepository = {
  async findMerchantByPhone(phone) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key, u.secret_key
      FROM users u
      WHERE u.phone = $1
      `,
      [phone],
    );
    return result.rows[0];
  },

  async findMerchantByEmail(email) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key, u.secret_key
      FROM users u
      WHERE u.email = $1
      `,
      [email],
    );
    return result.rows[0];
  },

  async findMerchantApiKey(apiKey) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key, u.secret_key
      FROM users u
      WHERE u.api_key = $1
      `,
      [apiKey],
    );
    return result.rows[0];
  },

  async findMerchantSecretKey(secretKey) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key, u.secret_key
      FROM users u
      WHERE u.secret_key = $1
      `,
      [secretKey],
    );
    return result.rows[0];
  },

  async resetFailedLogin(phone) {
    await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 0, locked_until = NULL
      WHERE phone = $1
      `,
      [phone],
    );
  },

  async registerFailedLogin({ phone, maxAttempts, lockMinutes }) {
    const result = await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
          locked_until = CASE
            WHEN COALESCE(failed_login_attempts, 0) + 1 >= $2::INT
            THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
            ELSE locked_until
          END
      WHERE phone = $1
      RETURNING failed_login_attempts
      `,
      [phone, maxAttempts, lockMinutes],
    );
    return result.rows[0];
  },

  async updateRefeshToken({ refreshToken, userId }) {
    await pool.query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [
      refreshToken,
      userId,
    ]);
  },

  async findMerchantByRefreshToken(refreshToken) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.balance, u.role, u.status
      FROM users u
      WHERE u.refresh_token = $1
        AND u.status = 'ACTIVE'
        AND u.role = 'MERCHANT'
      `,
      [refreshToken],
    );
    return result.rows[0];
  },

  async addMerchant({
    userId,
    phone,
    phoneHash,
    email,
    passwordHash,
    role = "MERCHANT",
    storeName,
    callbackUrl,
    apiKey,
    secretKey,
  }) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO users(id, phone, phone_hash, full_name, email, password_hash, role, call_back_url, api_key, secret_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          userId,
          phone,
          phoneHash,
          storeName,
          email,
          passwordHash,
          role,
          callbackUrl,
          apiKey,
          secretKey,
        ],
      );

      await client.query(
        `
        INSERT INTO user_kyc(id, user_id)
        VALUES ($1, $2)
        `,
        [phone, userId],
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async logout(userId) {
    await pool.query(
      "UPDATE users SET refresh_token = $1, fcm_token = $2 WHERE id = $3",
      [null, null, userId],
    );
  },
};

module.exports = merchantAuthRepository;