// auth.repository.js: Truy vấn tài khoản, khóa sai mật khẩu và refresh token của Merchant Sandbox.
const pool = require("../../../../config/database");
const { claimEmail } = require("../../../../utils/db/postgres");
const tokenUtil = require("../../../../utils/auth/jwt");
const { encryptSecretKey } = require("../../../../utils/security/keys");
const {
  createLoginLockoutMethods,
  createRefreshTokenMethods,
} = require("../../../../utils/auth/authRepositoryBase");

const merchantAuthRepository = {
  ...createLoginLockoutMethods({ db: pool, identifierCol: "phone" }),
  ...createRefreshTokenMethods({
    db: pool,
    hashRefresh: true,
    clearFcmOnLogout: true,
  }),

  async findMerchantByPhone(phone) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.must_change_password, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key
         FROM users u
        WHERE u.phone = $1`,
      [phone],
    );
    return result.rows[0];
  },

  async findMerchantByEmail(email) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.must_change_password, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key
         FROM users u
        WHERE u.email = $1`,
      [email],
    );
    return result.rows[0];
  },

  async findMerchantApiKey(apiKey) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.must_change_password, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key
         FROM users u
        WHERE u.api_key = $1`,
      [apiKey],
    );
    return result.rows[0];
  },

  async findMerchantByRefreshToken(refreshToken) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.balance, u.role, u.status, u.must_change_password
         FROM users u
        WHERE u.refresh_token = $1
          AND u.status = 'ACTIVE'
          AND u.role = 'MERCHANT'`,
      [tokenUtil.hashToken(refreshToken)],
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
    address = null,
    callbackUrl,
    apiKey,
    secretKey,
  }) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      email = await claimEmail(client, email);

      await client.query(
        `INSERT INTO users(id, phone, phone_hash, full_name, email, password_hash, role, call_back_url, api_key, secret_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
          encryptSecretKey(secretKey),
        ],
      );

      await client.query(
        `INSERT INTO user_kyc(id, user_id, address)
         VALUES ($1, $2, $3)`,
        [phone, userId, address],
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
};

module.exports = merchantAuthRepository;
