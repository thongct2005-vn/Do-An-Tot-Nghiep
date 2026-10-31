const pool = require("../../config/database");
const TransactionRepository = require("../../modules/transaction/transaction.repository");
const { httpError } = require("../../utils/httpError");
const { maskPhone } = require("../../utils/maskPhoneAndEmail");

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
        lba_bank.name AS default_bank_name,
        lba_bank.account_number AS default_bank_account
      FROM users u
      LEFT JOIN user_kyc k ON u.id = k.user_id
      LEFT JOIN LATERAL (
        SELECT lba.account_number, b.name
        FROM linked_bank_accounts lba
        JOIN banks b ON lba.bank_id = b.id
        WHERE lba.user_id = u.id AND lba.status = 'ACTIVE'
        ORDER BY lba.is_default DESC, lba.created_at DESC
        LIMIT 1
      ) lba_bank ON true
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

    const dailyResult = await pool.query(
      `
      SELECT COALESCE(SUM(amount + fee), 0)::BIGINT AS daily_used
      FROM transactions
      WHERE source_user_id = $1
        AND transaction_type IN ('TRANSFER', 'WITHDRAW', 'PAYMENT')
        AND status = 'SUCCESS'
        AND created_at >= date_trunc('day', NOW())
      `,
      [userId]
    );
    user.daily_used = Number(dailyResult.rows[0]?.daily_used || 0);

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

  async getUserTransactions({ userId, startDate, endDate, keyword, limit = 10, offset = 0 }) {
    const conditions = [
      `(t.source_user_id = $1 OR t.destination_user_id = $1)`
    ];
    const params = [userId];

    if (startDate) {
      params.push(startDate);
      conditions.push(`t.created_at >= $${params.length}`);
    }

    if (endDate) {
      params.push(endDate);
      conditions.push(`t.created_at <= $${params.length}`);
    }

    if (keyword && keyword.trim() !== "") {
      params.push(`%${keyword.trim()}%`);
      const kwIdx = params.length;
      conditions.push(
        `(t.id::TEXT LIKE $${kwIdx} 
          OR su.full_name ILIKE $${kwIdx} 
          OR du.full_name ILIKE $${kwIdx} 
          OR su.phone LIKE $${kwIdx} 
          OR du.phone LIKE $${kwIdx} 
          OR t.description ILIKE $${kwIdx} 
          OR b.name ILIKE $${kwIdx} 
          OR pr.reference_code ILIKE $${kwIdx})`
      );
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::INT AS total
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      WHERE ${whereClause}
      `,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    const queryParams = [...params];
    queryParams.push(limit);
    const limitIdx = queryParams.length;
    queryParams.push(offset);
    const offsetIdx = queryParams.length;

    const itemsResult = await pool.query(
      `
      SELECT 
        t.id,
        t.transaction_type,
        t.amount,
        t.fee,
        t.status,
        t.description,
        t.created_at,
        t.source_user_id,
        su.full_name AS source_name,
        su.phone AS source_phone,
        t.source_balance_before,
        t.source_balance_after,
        t.destination_user_id,
        du.full_name AS dest_name,
        du.phone AS dest_phone,
        t.dest_balance_before,
        t.dest_balance_after,
        b.name AS bank_name,
        lba.account_number AS bank_account,
        pr.reference_code
      FROM transactions t
      LEFT JOIN users su ON t.source_user_id = su.id
      LEFT JOIN users du ON t.destination_user_id = du.id
      LEFT JOIN linked_bank_accounts lba ON t.linked_bank_account_id = lba.id
      LEFT JOIN banks b ON lba.bank_id = b.id
      LEFT JOIN payment_requests pr ON pr.transaction_id = t.id
      WHERE ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      queryParams
    );

    return {
      total,
      items: itemsResult.rows,
    };
  },

  async checkPhoneConflict(userId, phone) {
    const result = await pool.query(
      `SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`,
      [phone, userId]
    );
    return result.rows.length > 0;
  },

  async checkEmailConflict(userId, email) {
    const result = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1`,
      [email, userId]
    );
    return result.rows.length > 0;
  },

  async updateUserProfile({
    userId,
    fullName,
    email,
    phone,
    phoneHash,
    revokeSession = false,
  }) {
    const updateFields = [];
    const updateValues = [];

    if (fullName !== undefined) {
      updateValues.push(fullName);
      updateFields.push(`full_name = $${updateValues.length}`);
    }

    if (phone !== undefined) {
      updateValues.push(phone);
      updateFields.push(`phone = $${updateValues.length}`);
      if (phoneHash) {
        updateValues.push(phoneHash);
        updateFields.push(`phone_hash = $${updateValues.length}`);
      }
    }

    if (email !== undefined) {
      updateValues.push(email);
      updateFields.push(`email = $${updateValues.length}`);
    }

    if (revokeSession) {
      updateFields.push(`refresh_token = NULL`);
      updateFields.push(`fcm_token = NULL`);
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(userId);
    const userIdIdx = updateValues.length;

    await pool.query(
      `UPDATE users SET ${updateFields.join(", ")} WHERE id = $${userIdIdx} AND role = 'USER'`,
      updateValues
    );

    return this.getUserDetail(userId);
  },

  async updateUserStatusWithHistory({
    userId,
    status,
    adminId,
    reason,
    oldValues,
    newValues,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const updateFields = ["status = $1", "updated_at = NOW()"];
      const updateParams = [status, userId];

      if (status === "BLOCKED") {
        updateFields.push("refresh_token = NULL");
        updateFields.push("fcm_token = NULL");
      }

      const updateQuery = `
        UPDATE users
        SET ${updateFields.join(", ")}
        WHERE id = $2 AND role = 'USER'
        RETURNING id, full_name, email, phone, status
      `;
      const userRes = await client.query(updateQuery, updateParams);
      const updatedUser = userRes.rows[0];

      if (!updatedUser) {
        await client.query("ROLLBACK");
        return null;
      }

      const action = status === "BLOCKED" ? "USER_BLOCKED" : "USER_UNBLOCKED";
      const historyQuery = `
        INSERT INTO admin_user_change_history (
          admin_id, user_id, action, reason, old_values, new_values, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING id, action, reason, created_at
      `;
      await client.query(historyQuery, [
        adminId,
        userId,
        action,
        reason,
        JSON.stringify(oldValues || {}),
        JSON.stringify(newValues || {}),
      ]);

      await client.query("COMMIT");
      return updatedUser;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async updateUserProfileWithHistory({
    userId,
    fullName,
    email,
    phone,
    phoneHash,
    revokeSession = false,
    adminId,
    reason,
    oldValues,
    newValues,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const updateFields = [];
      const updateValues = [];

      if (fullName !== undefined) {
        updateValues.push(fullName);
        updateFields.push(`full_name = $${updateValues.length}`);
      }

      if (phone !== undefined) {
        updateValues.push(phone);
        updateFields.push(`phone = $${updateValues.length}`);
        if (phoneHash) {
          updateValues.push(phoneHash);
          updateFields.push(`phone_hash = $${updateValues.length}`);
        }
      }

      if (email !== undefined) {
        updateValues.push(email);
        updateFields.push(`email = $${updateValues.length}`);
      }

      if (revokeSession) {
        updateFields.push(`refresh_token = NULL`);
        updateFields.push(`fcm_token = NULL`);
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(userId);
      const userIdIdx = updateValues.length;

      const updateQuery = `
        UPDATE users
        SET ${updateFields.join(", ")}
        WHERE id = $${userIdIdx} AND role = 'USER'
        RETURNING id
      `;
      const updateRes = await client.query(updateQuery, updateValues);
      if (!updateRes.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      const historyQuery = `
        INSERT INTO admin_user_change_history (
          admin_id, user_id, action, reason, old_values, new_values, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING id, action, reason, created_at
      `;
      await client.query(historyQuery, [
        adminId,
        userId,
        "USER_PROFILE_UPDATED",
        reason,
        JSON.stringify(oldValues || {}),
        JSON.stringify(newValues || {}),
      ]);

      await client.query("COMMIT");

      return this.getUserDetail(userId);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async getUserChangeHistory({ userId, limit = 10, offset = 0 }) {
    const countResult = await pool.query(
      `
      SELECT COUNT(*)::INT AS total
      FROM admin_user_change_history h
      WHERE h.user_id = $1
         OR (h.action = 'ADMIN_OP_P2P' AND (h.new_values->>'destination_user_id') = $1::text)
      `,
      [userId]
    );
    const total = countResult.rows[0]?.total || 0;

    const itemsResult = await pool.query(
      `
      SELECT 
        h.id,
        h.user_id,
        h.action,
        h.reason,
        h.old_values,
        h.new_values,
        h.created_at,
        CASE
          WHEN h.user_id = $1 THEN 'SOURCE'
          ELSE 'DESTINATION'
        END AS role_in_operation,
        a.id AS admin_id,
        a.full_name AS admin_name,
        a.email AS admin_email
      FROM admin_user_change_history h
      JOIN users a ON h.admin_id = a.id
      WHERE h.user_id = $1
         OR (h.action = 'ADMIN_OP_P2P' AND (h.new_values->>'destination_user_id') = $1::text)
      ORDER BY h.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    return {
      total,
      items: itemsResult.rows,
    };
  },

  async findAdminAuthById(adminId) {
    const result = await pool.query(
      `
      SELECT u.id, u.email, u.full_name, u.password_hash, u.status, u.role,
             u.failed_login_attempts, u.locked_until, (u.locked_until > NOW()) AS is_locked
      FROM users u
      WHERE u.id = $1
      `,
      [adminId]
    );
    return result.rows[0] || null;
  },

  async resetAdminFailedLogin(adminId) {
    await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 0, locked_until = NULL
      WHERE id = $1
      `,
      [adminId]
    );
  },

  async registerAdminFailedLogin({ adminId, maxAttempts = 5, lockMinutes = 30 }) {
    const result = await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
          locked_until = CASE
            WHEN COALESCE(failed_login_attempts, 0) + 1 >= $2::INT
            THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
            ELSE locked_until
          END
      WHERE id = $1
      RETURNING failed_login_attempts
      `,
      [adminId, maxAttempts, lockMinutes]
    );
    return result.rows[0] || null;
  },

  async getIdempotencyKey(idempotencyKey) {
    const result = await pool.query(
      `
      SELECT idempotency_key, actor_id, actor_type, request_path, status,
             response_body, request_hash, response_status_code, create_at
      FROM idempotency_keys
      WHERE idempotency_key = $1
      `,
      [idempotencyKey]
    );
    return result.rows[0] || null;
  },

  async tryInsertIdempotencyKey({
    idempotencyKey,
    actorId,
    actorType = "ADMIN",
    requestPath,
    requestHash,
  }) {
    const result = await pool.query(
      `
      INSERT INTO idempotency_keys (
        idempotency_key, actor_id, actor_type, request_path, request_hash, status
      )
      VALUES ($1, $2, $3, $4, $5, 'PENDING')
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING idempotency_key
      `,
      [idempotencyKey, actorId, actorType, requestPath, requestHash]
    );
    return result.rowCount === 1;
  },

  async reclaimIdempotencyKey({
    idempotencyKey,
    actorId,
    requestPath,
    requestHash,
    staleSeconds = 60,
  }) {
    const result = await pool.query(
      `
      UPDATE idempotency_keys
      SET status = 'PENDING',
          create_at = NOW(),
          response_body = NULL,
          response_status_code = NULL
      WHERE idempotency_key = $1
        AND actor_id = $2
        AND request_path = $3
        AND request_hash = $4
        AND (
          status = 'FAILED'
          OR (status = 'PENDING' AND create_at < NOW() - ($5::int * INTERVAL '1 second'))
        )
      RETURNING idempotency_key
      `,
      [idempotencyKey, actorId, requestPath, requestHash, staleSeconds]
    );
    return result.rowCount === 1;
  },

  async markIdempotencyKeyFailed(idempotencyKey) {
    await pool.query(
      `
      UPDATE idempotency_keys
      SET status = 'FAILED'
      WHERE idempotency_key = $1 AND status = 'PENDING'
      `,
      [idempotencyKey]
    );
  },

  async executeAdminP2PWithHistory({
    adminId,
    sourceUserId,
    destinationUserId,
    amount,
    fee = 0,
    description,
    reason,
    authorizationReference,
    idempotencyKey,
    requestHash,
    requestPath = "POST /api/v2/admin/user/:id/operations/p2p",
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const idemResult = await client.query(
        `
        SELECT idempotency_key, status, actor_id, request_path, request_hash,
               response_body, response_status_code
        FROM idempotency_keys
        WHERE idempotency_key = $1
        FOR UPDATE
        `,
        [idempotencyKey]
      );

      const idemRow = idemResult.rows[0];
      if (!idemRow) {
        throw httpError(400, "Không tìm thấy khóa Idempotency-Key hợp lệ");
      }

      if (
        (idemRow.actor_id && String(idemRow.actor_id) !== String(adminId)) ||
        (idemRow.request_path && idemRow.request_path !== requestPath) ||
        (requestHash && idemRow.request_hash && idemRow.request_hash !== requestHash)
      ) {
        throw httpError(
          422,
          "Mã Idempotency-Key đã được sử dụng với dữ liệu giao dịch khác"
        );
      }

      if (idemRow.status === "SUCCESS" && idemRow.response_body) {
        await client.query("ROLLBACK");
        return {
          replayed: true,
          responseBody: idemRow.response_body,
          notificationContext: null,
        };
      }

      const transferResult = await TransactionRepository.executeTransfer(
        client,
        {
          sourceUserId,
          destinationUserId,
          amount,
          fee,
          description,
          idempotencyKey,
          transactionType: "TRANSFER",
          status: "SUCCESS",
        }
      );

      const oldValues = {
        balance_before: Number(transferResult.sourceBalanceBefore),
      };

      const newValues = {
        balance_after: Number(transferResult.sourceBalanceAfter),
        transaction_id: String(transferResult.transactionId),
        transaction_type: "TRANSFER",
        amount: Number(transferResult.amount),
        fee: Number(transferResult.fee || 0),
        destination_user_id: String(destinationUserId),
        authorization_reference: authorizationReference,
        execution_mode: "SIMULATED_ADMIN_P2P",
      };

      const historyResult = await client.query(
        `
        INSERT INTO admin_user_change_history (
          admin_id, user_id, action, reason, old_values, new_values, created_at
        ) VALUES ($1, $2, 'ADMIN_OP_P2P', $3, $4, $5, NOW())
        RETURNING id, action, reason, created_at
        `,
        [
          adminId,
          sourceUserId,
          reason,
          JSON.stringify(oldValues),
          JSON.stringify(newValues),
        ]
      );

      const historyRow = historyResult.rows[0];

      const responseBody = {
        transaction_id: String(transferResult.transactionId),
        transaction_type: "TRANSFER",
        execution_mode: "SIMULATED_ADMIN_P2P",
        status: transferResult.status || "SUCCESS",
        amount: Number(transferResult.amount),
        fee: Number(transferResult.fee || 0),
        description: transferResult.description,
        reason,
        authorization_reference: authorizationReference,
        source_user_id: String(sourceUserId),
        source_user_name: transferResult.sourceUserName,
        source_balance_before: Number(transferResult.sourceBalanceBefore),
        source_balance_after: Number(transferResult.sourceBalanceAfter),
        destination_user_id: String(destinationUserId),
        destination_user_name: transferResult.destinationUserName,
        destination_phone_masked: maskPhone(transferResult.destinationPhone),
        audit_log_id: historyRow?.id || null,
        created_at: transferResult.createdAt,
      };

      await client.query(
        `
        UPDATE idempotency_keys
        SET status = 'SUCCESS',
            response_status_code = 200,
            response_body = $1
        WHERE idempotency_key = $2
        `,
        [JSON.stringify(responseBody), idempotencyKey]
      );

      await client.query("COMMIT");

      return {
        replayed: false,
        responseBody,
        notificationContext: {
          transactionId: String(transferResult.transactionId),
          amount: Number(transferResult.amount),
          description: transferResult.description,
          sourceUserId: String(sourceUserId),
          sourceUserName: transferResult.sourceUserName,
          sourceBalanceAfter: Number(transferResult.sourceBalanceAfter),
          destinationUserId: String(destinationUserId),
          destinationUserName: transferResult.destinationUserName,
          destBalanceAfter: Number(transferResult.destBalanceAfter),
        },
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
};

module.exports = adminUserRepository;
