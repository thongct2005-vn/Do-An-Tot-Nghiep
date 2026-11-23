// auth.repository.js: Truy vấn thông tin người dùng, TOTP, khóa đăng nhập sai và refresh token của App User.
const pool = require("../../config/database");
const { claimEmail } = require("../../utils/db/postgres");
const tokenUtil = require("../../utils/auth/jwt");
const {
  createLoginLockoutMethods,
  createRefreshTokenMethods,
  createTotpRepositoryMethods,
} = require("../../utils/auth/authRepositoryBase");

const authRepository = {
  ...createTotpRepositoryMethods(pool),
  ...createLoginLockoutMethods({ db: pool, identifierCol: "phone" }),
  ...createRefreshTokenMethods({
    db: pool,
    hashRefresh: true,
    clearFcmOnLogout: true,
  }),

  async findUserByPhone(phone) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role,
              u.totp_enabled, u.must_change_password, k.id AS cccd_number
         FROM users u
         LEFT JOIN user_kyc k ON k.user_id = u.id AND k.status = 'APPROVED'
        WHERE u.phone = $1`,
      [phone],
    );
    return result.rows[0];
  },

  async findUserByEmail(email) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role
         FROM users u
        WHERE u.email = $1`,
      [email],
    );
    return result.rows[0];
  },

  async findUserByRefreshToken(refreshToken) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.balance, u.role, u.status, u.must_change_password
         FROM users u
        WHERE u.refresh_token = $1`,
      [tokenUtil.hashToken(refreshToken)],
    );
    return result.rows[0];
  },

  async addUser({ userId, phone, phoneHash, email, passwordHash }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      email = await claimEmail(client, email);
      await client.query(
        `INSERT INTO users(id, phone, phone_hash, email, password_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, phone, phoneHash, email, passwordHash],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

module.exports = authRepository;
