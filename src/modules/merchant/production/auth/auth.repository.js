// auth.repository.js: Truy vấn hồ sơ Merchant Production, TOTP, khóa thất bại, quên mật khẩu và đổi email.
const pool = require("../../../../config/database");
const { claimEmail } = require("../../../../utils/db/postgres");
const tokenUtil = require("../../../../utils/auth/jwt");
const { encryptSecretKey } = require("../../../../utils/security/keys");
const merchantFeeService = require("../fee/fee.service");
const {
  createLoginLockoutMethods,
  createRefreshTokenMethods,
  createTotpRepositoryMethods,
} = require("../../../../utils/auth/authRepositoryBase");

const merchantAuthRepository = {
  ...createTotpRepositoryMethods(pool),
  ...createLoginLockoutMethods({ db: pool, identifierCol: "phone" }),
  ...createRefreshTokenMethods({
    db: pool,
    hashRefresh: true,
    clearFcmOnLogout: true,
  }),

  async findMerchantByPhone(phone) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.must_change_password, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key,
              u.totp_enabled, k.id AS tax_code
         FROM users u
         LEFT JOIN user_kyc k ON k.user_id = u.id AND k.status = 'APPROVED'
        WHERE u.phone = $1`,
      [phone],
    );
    return result.rows[0];
  },

  async findMerchantByEmail(email) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key,
              u.totp_enabled
         FROM users u
        WHERE u.email = $1`,
      [email],
    );
    return result.rows[0];
  },

  async findMerchantApiKey(apiKey) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key,
              u.totp_enabled
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
    taxCode,
    address = null,
    callbackUrl,
    apiKey,
    secretKey,
    status = "APPROVED",
    feePlan = "PER_TRANSACTION",
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
        `INSERT INTO user_kyc(id, user_id, address, status)
         VALUES ($1, $2, $3, $4)`,
        [taxCode, userId, address, status],
      );

      await merchantFeeService.initFeeSettingOnRegisterTx(client, {
        merchantUserId: userId,
        feePlan,
      });

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async findMerchantById(userId) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.role,
              u.totp_enabled
         FROM users u
        WHERE u.id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  async findMerchantForForgotByPhone(phone) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.role,
              u.totp_enabled, k.id AS tax_code
         FROM users u
         LEFT JOIN LATERAL (
           SELECT yk.id
             FROM user_kyc yk
            WHERE yk.user_id = u.id
              AND yk.status IN ('APPROVED', 'APPPROVED')
            ORDER BY yk.updated_at DESC NULLS LAST, yk.created_at DESC NULLS LAST
            LIMIT 1
         ) k ON true
        WHERE u.phone = $1`,
      [phone],
    );
    return result.rows[0] ?? null;
  },

  async findMerchantForResetById(userId) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.role, u.status, u.password_hash, k.id AS tax_code
         FROM users u
         LEFT JOIN LATERAL (
           SELECT yk.id
             FROM user_kyc yk
            WHERE yk.user_id = u.id
              AND yk.status IN ('APPROVED', 'APPPROVED')
            ORDER BY yk.updated_at DESC NULLS LAST, yk.created_at DESC NULLS LAST
            LIMIT 1
         ) k ON true
        WHERE u.id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  async resetPassword({ userId, passwordHash, oldPasswordHash }) {
    const result = await pool.query(
      `UPDATE users
          SET password_hash = $1,
              refresh_token = NULL,
              failed_login_attempts = 0,
              locked_until = NULL
        WHERE id = $2 AND password_hash IS NOT DISTINCT FROM $3
        RETURNING id`,
      [passwordHash, userId, oldPasswordHash],
    );
    return result.rows[0] ?? null;
  },

  async isEmailClaimedByOther(email, excludeUserId) {
    const normalized = String(email ?? "").trim().toLowerCase();
    const result = await pool.query(
      `SELECT 1
         FROM users
        WHERE LOWER(BTRIM(email)) = $1
          AND id <> $2::uuid
        LIMIT 1`,
      [normalized, excludeUserId],
    );
    return result.rowCount > 0;
  },

  async updateEmail({ userId, newEmail, oldEmail, oldPasswordHash }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const claimedEmail = await claimEmail(client, newEmail, userId);
      const result = await client.query(
        `UPDATE users
            SET email = $1,
                updated_at = NOW()
          WHERE id = $2
            AND role = 'MERCHANT'
            AND status = 'ACTIVE'
            AND LOWER(BTRIM(email)) IS NOT DISTINCT FROM $3
            AND password_hash IS NOT DISTINCT FROM $4
          RETURNING id, email`,
        [
          claimedEmail,
          userId,
          oldEmail ? oldEmail.trim().toLowerCase() : null,
          oldPasswordHash,
        ],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("COMMIT");
      return result.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
};

module.exports = merchantAuthRepository;
