// auth.repository.js: Truy vấn thông tin đăng nhập, khóa thất bại và quản lý phiên refresh token của Admin.
const pool = require("../../config/database");
const {
  createLoginLockoutMethods,
  createRefreshTokenMethods,
} = require("../../utils/auth/authRepositoryBase");

const adminAuthRepository = {
  ...createLoginLockoutMethods({
    db: pool,
    identifierCol: "email",
  }),
  ...createRefreshTokenMethods({
    db: pool,
    hashRefresh: false,
    roleFilterSql: "role = 'ADMIN'",
  }),

  async findAdminByEmail(email) {
    const result = await pool.query(
      `SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
              u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role
         FROM users u
        WHERE u.email = $1`,
      [email],
    );
    return result.rows[0];
  },

  async rotateRefreshToken({ userId, oldRefreshToken, newRefreshToken }) {
    const result = await pool.query(
      `UPDATE users SET refresh_token = $1
        WHERE id = $2 AND refresh_token = $3 AND role = 'ADMIN' AND status = 'ACTIVE'
        RETURNING id`,
      [newRefreshToken, userId, oldRefreshToken],
    );
    return result.rowCount === 1;
  },

  async findAdminByRefreshToken(refreshToken) {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.status
         FROM users u
        WHERE u.refresh_token = $1 AND u.role = 'ADMIN'`,
      [refreshToken],
    );
    return result.rows[0];
  },

  async findAdminById(adminId) {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.status
         FROM users u
        WHERE u.id = $1 AND u.role = 'ADMIN'`,
      [adminId],
    );
    return result.rows[0];
  },

  async findAdminSessionById(adminId) {
    const result = await pool.query(
      `SELECT id, status, refresh_token FROM users
        WHERE id = $1 AND role = 'ADMIN'`,
      [adminId],
    );
    return result.rows[0];
  },
};

module.exports = adminAuthRepository;
