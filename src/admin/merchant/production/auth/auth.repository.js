const pool = require("../../../../config/database");
const tokenUtil = require("../../../../utils/jwt");
const { encryptSecretKey } = require("../../../../utils/hashSecretKey");

const merchantAuthRepository = {
  // Lấy thông tin merchant theo phone
  async findMerchantByPhone(phone) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key,
             u.totp_enabled
      FROM users u
      WHERE u.phone = $1
      `,
      [phone],
    );
    return result.rows[0];
  },

  // Lấy thông tin merchant theo email
  async findMerchantByEmail(email) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key,
             u.totp_enabled
      FROM users u
      WHERE u.email = $1
      `,
      [email],
    );
    return result.rows[0];
  },

  // Lấy thông tin merchant theo apiKey
  async findMerchantApiKey(apiKey) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.email, u.password_hash, u.status, u.failed_login_attempts,
             u.locked_until, (u.locked_until > NOW()) AS is_locked, u.balance, u.role, u.call_back_url, u.api_key,
             u.totp_enabled
      FROM users u
      WHERE u.api_key = $1
      `,
      [apiKey],
    );
    return result.rows[0];
  },

  // Làm mới số lần đăng nhập thất bại
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

  // Tăng số lần đăng nhập thất bại thêm một, nếu lớn hơn số lần tối đa thì khóa
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

  // Cập nhật lại refesh token
  async updateRefeshToken({ refreshToken, userId }) {
    await pool.query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [
      tokenUtil.hashToken(refreshToken),
      userId,
    ]);
  },

  // Lấy thông tin cơ bản của merchant từ refesh token 
  async findMerchantByRefreshToken(refreshToken) {
    const result = await pool.query(
      `
      SELECT u.id, u.phone, u.full_name, u.balance, u.role, u.status
      FROM users u
      WHERE u.refresh_token = $1
        AND u.status = 'ACTIVE'
        AND u.role = 'MERCHANT'
      `,
      [tokenUtil.hashToken(refreshToken)],
    );
    return result.rows[0];
  },

  // Thêm một merchant + kyc cho merchant
  async addMerchant({
    userId,
    phone,
    phoneHash,
    email,
    passwordHash,
    role = "MERCHANT",
    storeName,
    taxCode,
    callbackUrl,
    apiKey,
    secretKey,
    status = "APPPROVED",
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
          encryptSecretKey(secretKey),
        ],
      );

      await client.query(
        `
        INSERT INTO user_kyc(id, user_id, status)
        VALUES ($1, $2, $3)
        `,
        [taxCode, userId, status],
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  // Đăng xuất, xóa các token duy trì đăng nhập, thông báo
  async logout(userId) {
    await pool.query(
      "UPDATE users SET refresh_token = $1, fcm_token = $2 WHERE id = $3",
      [null, null, userId],
    );
  },

  // Lấy thông tin, trạng thái của mã google authenticator
  async getTotpState(userId) {
    const result = await pool.query(
      `
      SELECT totp_secret, totp_enabled, totp_last_step,
             (totp_locked_until > NOW()) AS is_totp_locked
      FROM users
      WHERE id = $1
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  // Lưu secret tạo otp
  async saveTotpSecret({ userId, encryptedSecret }) {
    const result = await pool.query(
      `
      UPDATE users
      SET totp_secret = $1, totp_enabled = false, totp_last_step = NULL,
          totp_failed_attempts = 0, totp_locked_until = NULL
      WHERE id = $2 AND totp_enabled = false
      RETURNING id
      `,
      [encryptedSecret, userId],
    );
    return result.rows[0] ?? null;
  },

  // Cập nhật đã bật totp (time base - one time password)
  async enableTotp(userId) {
    const result = await pool.query(
      `
      UPDATE users
      SET totp_enabled = true
      WHERE id = $1 AND totp_enabled = false AND totp_secret IS NOT NULL
      RETURNING id
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  // Cập nhật tắt totp
  async disableTotp(userId) {
    await pool.query(
      `
      UPDATE users
      SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL,
          totp_failed_attempts = 0, totp_locked_until = NULL
      WHERE id = $1
      `,
      [userId],
    );
  },

  // Cập nhật mã vừa dùng thành công, tránh dùng lại khi vẫn còn thời gian sử dụng
  async consumeTotpStep({ userId, step }) {
    const result = await pool.query(
      `
      UPDATE users
      SET totp_last_step = $2, totp_failed_attempts = 0, totp_locked_until = NULL
      WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
      RETURNING id
      `,
      [userId, step],
    );
    return result.rowCount === 1;
  },

  // Tăng số lần sai topt thêm một, nếu lớn hơn số lần tối đa thì khóa
  async registerTotpFailure({ userId, maxAttempts, lockMinutes }) {
    const result = await pool.query(
      `
      UPDATE users
      SET totp_failed_attempts = n.attempts,
          totp_locked_until = CASE
            WHEN n.attempts >= $2::INT
            THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
            ELSE NULL
          END
      FROM (
        SELECT id,
               CASE
                 WHEN totp_locked_until IS NOT NULL AND totp_locked_until <= NOW() THEN 1
                 ELSE COALESCE(totp_failed_attempts, 0) + 1
               END AS attempts
        FROM users
        WHERE id = $1
      ) n
      WHERE users.id = n.id
      RETURNING users.totp_failed_attempts
      `,
      [userId, maxAttempts, lockMinutes],
    );
    return result.rows[0];
  },
};

module.exports = merchantAuthRepository;
