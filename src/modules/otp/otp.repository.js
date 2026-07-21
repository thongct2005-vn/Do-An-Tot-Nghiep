const pool = require("../../config/database");

const otpRepository = {
  async findOtp({ phone, email, purpose }) {
    let query = `SELECT * FROM otp_tracking WHERE used_at is null`;
    let params = [];
    if (phone) {
      params.push(phone);
      query += ` AND phone = $${params.length}`;
    }
    if (email) {
      params.push(email);
      query += ` AND email = $${params.length}`;
    }
    if (purpose) {
      params.push(purpose);
      query += ` AND purpose = $${params.length}`;
    }

    const result = await pool.query(query, params);
    return result.rows[0];
  },

  async findExistingOtp({ phone, email }) {
    let query = `SELECT id FROM otp_tracking WHERE`;
    let params = [];
    if (phone) {
      params.push(phone);
      query += ` phone = $1`;
    } else if (email) {
      params.push(email);
      query += ` email = $1`;
    }

    const result = await pool.query(query, params);
    return result.rows[0];
  },

  async createOtp({ id, phone, email, otpHash, purpose, expiredMinutes }) {
    const query = `INSERT INTO otp_tracking(id, phone, email, otp_hash,
             purpose, expired_at, failed_attempts, locked_until, used_at, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW() + ($6::TEXT || ' minutes'):: INTERVAL, 0, NULL, NULL, NOW())
            `;

    await pool.query(query, [
      id,
      phone,
      email,
      otpHash,
      purpose,
      expiredMinutes,
    ]);
  },

  async updateOtp({ phone, email, otpHash, purpose, expiredMinutes }) {
    let query = `UPDATE otp_tracking SET otp_hash = $1, purpose = $2, expired_at = NOW() + ($3::TEXT || ' minutes')::INTERVAL,
    failed_attempts = 0, locked_until = null, used_at = null, created_at = NOW()
    WHERE
    `;
    let params = [otpHash, purpose, expiredMinutes];
    if (phone) {
      params.push(phone);
      query += ` phone = $4`;
    } else if (email) {
      params.push(email);
      query += ` email = $4`;
    }

    await pool.query(query, params);
  },

  async updateFailedAttempts({ phone, email, attempts }) {
    let query = `UPDATE otp_tracking SET failed_attempts = $1 WHERE`;
    let params = [attempts];
    if (phone) {
      params.push(phone);
      query += ` phone = $2`;
    } else if (email) {
      params.push(email);
      query += ` email = $2`;
    }
    await pool.query(query, params);
  },

  async lockAccount({ phone, email, attempts, lockMinutes }) {
    let query = `UPDATE otp_tracking SET failed_attempts = $1, locked_until = NOW() + ($2::TEXT || ' minutes')::INTERVAL WHERE`;
    let params = [attempts, lockMinutes];
    if (phone) {
      params.push(phone);
      query += ` phone = $3`;
    } else if (email) {
      params.push(email);
      query += ` email = $3`;
    }
    await pool.query(query, params);
  },

  async markAsUsed({ phone, email }) {
    let query = `UPDATE otp_tracking SET used_at = NOW() WHERE`;
    let params = [];
    if (phone) {
      params.push(phone);
      query += ` phone = $1`;
    } else if (email) {
      params.push(email);
      query += ` email = $1`;
    }
    await pool.query(query, params);
  },
};

module.exports = otpRepository;
