// auth.repository.js: Truy vấn thông tin đăng nhập và tạo người dùng thử nghiệm cho User Sandbox.
const pool = require("../../../../../config/database");
const { claimEmail } = require("../../../../../utils/db/postgres");
const {
  createLoginLockoutMethods,
  createRefreshTokenMethods,
} = require("../../../../../utils/auth/authRepositoryBase");

const authRepository = {
  ...createLoginLockoutMethods({ db: pool, identifierCol: "phone" }),
  ...createRefreshTokenMethods({
    db: pool,
    hashRefresh: false,
    clearFcmOnLogout: true,
  }),

  async findUserByPhone(phone) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role
         FROM users u
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
      `SELECT u.id, u.phone, u.full_name, u.balance, u.role
         FROM users u
        WHERE u.refresh_token = $1`,
      [refreshToken],
    );
    return result.rows[0];
  },

  async createUserWithKyc({
    userId,
    phone,
    phoneHash,
    email,
    passwordHash,
    status = "APPROVED",
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      email = await claimEmail(client, email);

      await client.query(
        `INSERT INTO users(id, phone, phone_hash, email, password_hash, full_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, phone, phoneHash, email, passwordHash, "unknow"],
      );

      await client.query(
        `INSERT INTO user_kyc(id, user_id, status)
         VALUES ($1, $2, $3)`,
        [phone, userId, status],
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
