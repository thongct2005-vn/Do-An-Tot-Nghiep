const pool = require("../../config/database");

const adminUserRepository = {
  async getUserStats() {
    const result = await pool.query(`
      SELECT
        COUNT(*)::INT AS total_count,
        COUNT(*) FILTER (WHERE status = 'ACTIVE')::INT AS active_count,
        COUNT(*) FILTER (WHERE status = 'BLOCKED')::INT AS suspended_count
      FROM users
      WHERE role = 'USER'
    `);
    return result.rows[0];
  },

  async getUsers({ search, status, limit = 10, offset = 0 }) {
    const conditions = ["u.role = 'USER'"];
    const params = [];

    if (status && status !== "ALL") {
      params.push(status);
      conditions.push(`u.status = $${params.length}`);
    }

    if (search && search.trim() !== "") {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(u.full_name ILIKE $${params.length} OR u.phone LIKE $${params.length} OR u.email ILIKE $${params.length} OR u.id::TEXT LIKE $${params.length})`
      );
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::INT AS total
      FROM users u
      WHERE ${whereClause}
      `,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    const queryParams = [...params];
    queryParams.push(limit);
    const limitIndex = queryParams.length;
    queryParams.push(offset);
    const offsetIndex = queryParams.length;

    const itemsResult = await pool.query(
      `
      SELECT 
        u.id,
        u.full_name,
        u.email,
        u.phone,
        u.balance,
        u.status,
        u.created_at,
        u.updated_at,
        k.status AS kyc_status,
        b.name AS default_bank_name,
        lba.account_number AS default_bank_account
      FROM users u
      LEFT JOIN user_kyc k ON u.id = k.user_id
      LEFT JOIN linked_bank_accounts lba ON u.id = lba.user_id AND lba.is_default = true
      LEFT JOIN banks b ON lba.bank_id = b.id
      WHERE ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      queryParams
    );

    return {
      total,
      items: itemsResult.rows,
    };
  },

  async getUserDetail(userId) {
    const userResult = await pool.query(
      `
      SELECT 
        u.id,
        u.role,
        u.full_name,
        u.email,
        u.phone,
        u.status,
        u.balance,
        u.created_at,
        u.updated_at,
        u.failed_login_attempts,
        u.locked_until
      FROM users u
      WHERE u.id = $1 AND u.role = 'USER'
      `,
      [userId]
    );

    if (!userResult.rows[0]) return null;
    const user = userResult.rows[0];

    const kycResult = await pool.query(
      `
      SELECT 
        id AS cccd_number,
        dob,
        gender,
        address,
        front_image_url,
        back_image_url,
        face_image_url,
        face_match_score,
        status,
        created_at,
        updated_at
      FROM user_kyc
      WHERE user_id = $1
      `,
      [userId]
    );
    user.kyc = kycResult.rows[0] || null;

    const banksResult = await pool.query(
      `
      SELECT 
        l.id,
        b.name AS bank_name,
        b.code AS bank_code,
        b.logo_url,
        l.account_number,
        l.account_holder_name,
        l.is_default,
        l.status,
        l.created_at
      FROM linked_bank_accounts l
      JOIN banks b ON l.bank_id = b.id
      WHERE l.user_id = $1
      ORDER BY l.is_default DESC, l.created_at DESC
      `,
      [userId]
    );
    user.linked_banks = banksResult.rows;

    return user;
  },

  async updateUserStatus({ userId, status }) {
    const result = await pool.query(
      `
      UPDATE users
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND role = 'USER'
      RETURNING id, full_name, email, phone, status
      `,
      [status, userId]
    );
    return result.rows[0];
  },
};

module.exports = adminUserRepository;
