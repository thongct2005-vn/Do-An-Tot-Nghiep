const pool = require("../../config/database");
const crypto = require("node:crypto");
const { httpError } = require("../../utils/httpError");
const { claimEmail } = require("../../utils/emailClaim");
const { PROFILE_FIELDS, comparableProfileValue } = require("./merchants.profile");

const KYC_LATERAL_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      yk.id AS tax_code,
      CASE
        WHEN yk.status IN ('APPROVED', 'APPPROVED') THEN 'APPROVED'
        WHEN yk.status = 'REJECTED' THEN 'REJECTED'
        ELSE 'PENDING'
      END AS approval_status,
      yk.status AS raw_kyc_status,
      yk.dob,
      yk.gender,
      yk.address,
      yk.front_image_url,
      yk.back_image_url,
      yk.face_image_url,
      yk.face_match_score,
      yk.created_at AS kyc_created_at,
      yk.updated_at AS kyc_updated_at
    FROM user_kyc yk
    WHERE yk.user_id = u.id
    ORDER BY yk.updated_at DESC NULLS LAST, yk.created_at DESC NULLS LAST
    LIMIT 1
  ) k ON true
`;

const APPROVAL_STATUS_EXPR = `COALESCE(k.approval_status, 'PENDING')`;
const CONFIGURED_EXPR = `(u.api_key IS NOT NULL AND u.secret_key IS NOT NULL
  AND u.call_back_url IS NOT NULL AND TRIM(u.call_back_url) <> '')`;
const LINKED_EXPR = `(u.status = 'ACTIVE' AND ${CONFIGURED_EXPR})`;
const UNCONFIGURED_EXPR = `(u.status = 'ACTIVE' AND NOT ${CONFIGURED_EXPR})`;
const SUSPENDED_EXPR = `u.status IN ('SUSPENDED', 'BLOCKED')`;
const PENDING_EXPR = `${APPROVAL_STATUS_EXPR} = 'PENDING'`;

const OPERATIONAL_STATUS_EXPR = `
  CASE
    WHEN u.status IN ('SUSPENDED', 'BLOCKED') THEN 'SUSPENDED'
    WHEN u.status = 'ACTIVE' THEN 'ACTIVE'
    ELSE 'UNKNOWN'
  END
`;

const API_STATUS_EXPR = `
  CASE
    WHEN u.status IN ('SUSPENDED', 'BLOCKED') THEN 'LOCKED'
    WHEN u.status IS DISTINCT FROM 'ACTIVE' THEN 'NOT_CONNECTED'
    WHEN u.api_key IS NULL OR u.secret_key IS NULL THEN 'PENDING_KEY'
    WHEN NOT ${CONFIGURED_EXPR} THEN 'NOT_CONNECTED'
    ELSE 'LINKED'
  END
`;

const adminMerchantsRepository = {
  async updateMerchantStatus({ merchantId, adminId, status, expectedStatus, reason }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const locked = await client.query(
        "SELECT id, status FROM users WHERE id=$1 AND role='MERCHANT' FOR UPDATE",
        [merchantId],
      );
      const current = locked.rows[0];
      if (!current) throw httpError(404, "Không tìm thấy đối tác merchant");
      if (current.status !== expectedStatus) {
        throw httpError(409, "Trạng thái merchant đã thay đổi, vui lòng tải lại thông tin");
      }
      if (current.status === status) {
        throw httpError(409, "Tài khoản merchant hiện đã ở trạng thái này");
      }
      const updated = await client.query(
        `UPDATE users SET status=$2::varchar, updated_at=NOW(),
          refresh_token=CASE WHEN $2::varchar='BLOCKED' THEN NULL ELSE refresh_token END
         WHERE id=$1 AND role='MERCHANT' RETURNING id, status, updated_at`,
        [merchantId, status],
      );
      const action = status === "BLOCKED" ? "MERCHANT_BLOCKED" : "MERCHANT_UNBLOCKED";
      const audit = await client.query(
        `INSERT INTO admin_user_change_history
          (admin_id, user_id, action, reason, old_values, new_values, created_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,NOW())
         RETURNING id, action, reason, created_at`,
        [adminId, merchantId, action, reason,
          JSON.stringify({ status: current.status }), JSON.stringify({ status })],
      );
      await client.query("COMMIT");
      return { merchant: updated.rows[0], audit: audit.rows[0] };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async updateMerchantProfile({ merchantId, adminId, values, reason }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      // Check the target before exposing identity conflicts; take the email lock
      // before the row lock, consistently with all other application writers.
      const target = await client.query("SELECT id FROM users WHERE id=$1 AND role='MERCHANT'", [merchantId]);
      if (!target.rowCount) throw httpError(404, "Không tìm thấy đối tác merchant");
      if (values.email !== undefined) await claimEmail(client, values.email, merchantId);
      const locked = await client.query(`SELECT id, full_name, phone, email, call_back_url
        FROM users WHERE id=$1 AND role='MERCHANT' FOR UPDATE`, [merchantId]);
      const current = locked.rows[0];
      if (!current) throw httpError(404, "Không tìm thấy đối tác merchant");
      const oldValues = {}, newValues = {};
      for (const field of PROFILE_FIELDS) {
        if (Object.hasOwn(values, field) &&
            comparableProfileValue(field, current[field]) !== values[field]) {
          oldValues[field] = current[field] ?? null;
          newValues[field] = values[field];
        }
      }
      if (!Object.keys(newValues).length) throw httpError(400, "Không có thông tin nào thay đổi so với hiện tại");
      const revokeSession = Object.hasOwn(newValues, "phone") || Object.hasOwn(newValues, "email");
      const params = Object.values(newValues);
      const assignments = Object.keys(newValues).map((field, i) => `${field}=$${i + 1}`);
      if (Object.hasOwn(newValues, "phone")) {
        params.push(crypto.createHash("sha256").update(newValues.phone).digest("hex"));
        assignments.push(`phone_hash=$${params.length}`);
      }
      if (revokeSession) assignments.push("refresh_token=NULL", "fcm_token=NULL");
      assignments.push("updated_at=NOW()");
      params.push(merchantId);
      const updated = await client.query(`UPDATE users SET ${assignments.join(", ")}
        WHERE id=$${params.length} AND role='MERCHANT'
        RETURNING id, full_name, phone, email, call_back_url, updated_at`, params);
      const audit = await client.query(`INSERT INTO admin_user_change_history
        (admin_id, user_id, action, reason, old_values, new_values, created_at)
        VALUES($1,$2,'USER_PROFILE_UPDATED',$3,$4::jsonb,$5::jsonb,NOW())
        RETURNING id, action, reason, created_at`,
      [adminId, merchantId, reason, JSON.stringify(oldValues), JSON.stringify(newValues)]);
      await client.query("COMMIT");
      return { merchant: updated.rows[0], audit: audit.rows[0], revokeSession };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505" && error.table === "users" && /phone|email/.test(error.constraint || "")) {
        throw httpError(409, "Số điện thoại hoặc email đã được đăng ký bởi tài khoản khác");
      }
      throw error;
    } finally {
      client.release();
    }
  },

  async getMerchantListSnapshot(options) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const stats = await this.getMerchantStats(client);
      const list = await this.getMerchants(options, client);
      await client.query('COMMIT');
      return { stats, ...list };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async getMerchantStats(db = pool) {
    const result = await db.query(`
      SELECT
        COUNT(*)::INT AS total_merchants,
        COUNT(*) FILTER (
          WHERE ${LINKED_EXPR}
        )::INT AS linked_merchants,
        COUNT(*) FILTER (
          WHERE ${PENDING_EXPR}
        )::INT AS pending_merchants,
        COUNT(*) FILTER (
          WHERE ${UNCONFIGURED_EXPR}
        )::INT AS unconfigured_merchants,
        COUNT(*) FILTER (
          WHERE ${SUSPENDED_EXPR}
        )::INT AS suspended_merchants
      FROM users u
      ${KYC_LATERAL_JOIN}
      WHERE u.role = 'MERCHANT'
    `);
    return (
      result.rows[0] || {
        total_merchants: 0,
        linked_merchants: 0,
        pending_merchants: 0,
        unconfigured_merchants: 0,
        suspended_merchants: 0,
      }
    );
  },

  async getMerchants({
    search,
    tab,
    approvalStatus,
    status,
    apiStatus,
    startDate,
    endDate,
    limit = 10,
    offset = 0,
  }, db = pool) {
    const conditions = ["u.role = 'MERCHANT'"];
    const params = [];

    if (tab && tab !== "ALL") {
      if (tab === "LINKED") {
        conditions.push(
          LINKED_EXPR
        );
      } else if (tab === "PENDING") {
        conditions.push(PENDING_EXPR);
      } else if (tab === "UNCONFIGURED") {
        conditions.push(
          UNCONFIGURED_EXPR
        );
      } else if (tab === "SUSPENDED") {
        conditions.push(SUSPENDED_EXPR);
      }
    }

    if (approvalStatus && approvalStatus !== "ALL") {
      params.push(approvalStatus);
      conditions.push(`${APPROVAL_STATUS_EXPR} = $${params.length}`);
    }

    if (status && status !== "ALL") {
      if (status === "SUSPENDED" || status === "BLOCKED") {
        conditions.push(`u.status IN ('SUSPENDED', 'BLOCKED')`);
      } else if (status === "ACTIVE") {
        conditions.push(
          `u.status = 'ACTIVE'`
        );
      } else if (status === "PENDING_ACTIVATION") {
        conditions.push(`${APPROVAL_STATUS_EXPR} = 'PENDING'`);
      } else if (status === "DISABLED") {
        conditions.push(`${APPROVAL_STATUS_EXPR} = 'REJECTED'`);
      } else {
        params.push(status);
        conditions.push(`${OPERATIONAL_STATUS_EXPR} = $${params.length}`);
      }
    }

    if (apiStatus && apiStatus !== "ALL") {
      params.push(apiStatus);
      conditions.push(`${API_STATUS_EXPR} = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      conditions.push(`u.created_at >= $${params.length}`);
    }

    if (endDate) {
      params.push(endDate);
      conditions.push(`u.created_at < $${params.length}`);
    }

    if (search && search.trim() !== "") {
      const cleanSearch = search.trim();
      params.push(`%${cleanSearch}%`);
      const idx = params.length;
      conditions.push(
        `(
          u.full_name ILIKE $${idx}
          OR u.phone LIKE $${idx}
          OR COALESCE(u.email, '') ILIKE $${idx}
          OR COALESCE(k.tax_code, '') ILIKE $${idx}
          OR u.id::TEXT ILIKE $${idx}
          OR ('MER-' || UPPER(RIGHT(REPLACE(u.id::TEXT, '-', ''), 5))) ILIKE $${idx}
        )`
      );
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await db.query(
      `
      SELECT COUNT(*)::INT AS total
      FROM users u
      ${KYC_LATERAL_JOIN}
      WHERE ${whereClause}
      `,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    const queryParams = [...params, limit, offset];
    const limitIdx = queryParams.length - 1;
    const offsetIdx = queryParams.length;

    const itemsResult = await db.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.phone,
        u.balance,
        u.status AS raw_user_status,
        u.call_back_url,
        (u.api_key IS NOT NULL) AS has_api_key,
        (u.secret_key IS NOT NULL) AS has_secret_key,
        u.totp_enabled,
        u.created_at,
        u.updated_at,
        k.tax_code,
        k.address,
        lb.account_holder_name AS owner_name,
        ${APPROVAL_STATUS_EXPR} AS approval_status,
        ${OPERATIONAL_STATUS_EXPR} AS operational_status,
        ${API_STATUS_EXPR} AS api_status
      FROM users u
      ${KYC_LATERAL_JOIN}
      LEFT JOIN LATERAL (
        SELECT l.account_holder_name
        FROM linked_bank_accounts l
        WHERE l.user_id = u.id
        ORDER BY l.is_default DESC, l.created_at DESC
        LIMIT 1
      ) lb ON true
      WHERE ${whereClause}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      queryParams
    );

    return {
      total,
      items: itemsResult.rows,
    };
  },

  async getMerchantDetail(merchantId) {
    const merchantResult = await pool.query(
      `
      SELECT
        u.id,
        u.role,
        u.full_name,
        u.email,
        u.phone,
        u.balance,
        u.status AS raw_user_status,
        u.call_back_url,
        u.api_key,
        (u.secret_key IS NOT NULL) AS has_secret_key,
        u.totp_enabled,
        u.failed_login_attempts,
        u.locked_until,
        u.created_at,
        u.updated_at,
        k.tax_code,
        k.raw_kyc_status,
        k.dob,
        k.gender,
        k.address,
        k.front_image_url,
        k.back_image_url,
        k.face_image_url,
        k.face_match_score,
        k.kyc_created_at,
        k.kyc_updated_at,
        ${APPROVAL_STATUS_EXPR} AS approval_status,
        ${OPERATIONAL_STATUS_EXPR} AS operational_status,
        ${API_STATUS_EXPR} AS api_status
      FROM users u
      ${KYC_LATERAL_JOIN}
      WHERE u.id = $1 AND u.role = 'MERCHANT'
      `,
      [merchantId]
    );

    const merchant = merchantResult.rows[0];
    if (!merchant) return null;

    const [banksResult, latestDecisionResult, apiStatsResult, volumeStatsResult] =
      await Promise.all([
        pool.query(
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
          [merchantId]
        ),
        pool.query(
          `
          SELECT
            h.id,
            h.action,
            h.reason,
            h.old_values,
            h.new_values,
            h.created_at,
            a.id AS admin_id,
            a.full_name AS admin_name,
            a.email AS admin_email,
            a.role AS admin_role
          FROM admin_user_change_history h
          JOIN users a ON h.admin_id = a.id
          WHERE h.user_id = $1
            AND h.action <> 'USER_PROFILE_UPDATED'
          ORDER BY h.created_at DESC
          LIMIT 1
          `,
          [merchantId]
        ),
        pool.query(
          `
          SELECT
            COUNT(*)::INT AS total_requests,
            COUNT(*) FILTER (WHERE pr.status = 'SUCCESS')::INT AS success_requests,
            MAX(pr.created_at) AS last_api_call_at,
            (
              SELECT pr2.reference_code
              FROM payment_requests pr2
              WHERE pr2.destination_user_id = $1
              ORDER BY pr2.created_at DESC
              LIMIT 1
            ) AS last_payment_reference,
            (
              SELECT pr2.transaction_id
              FROM payment_requests pr2
              WHERE pr2.destination_user_id = $1
              ORDER BY pr2.created_at DESC
              LIMIT 1
            ) AS last_transaction_id,
            (
              SELECT wd.last_http_status
              FROM webhook_deliveries wd
              WHERE wd.merchant_id = $1
              ORDER BY wd.created_at DESC
              LIMIT 1
            ) AS last_webhook_status
          FROM payment_requests pr
          WHERE pr.destination_user_id = $1
          `,
          [merchantId]
        ),
        pool.query(
          `
          SELECT
            COALESCE(
              SUM(t.amount) FILTER (
                WHERE t.destination_user_id = $1
                  AND t.status = 'SUCCESS'
                  AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
                  AND date_trunc('month', t.created_at) = date_trunc('month', CURRENT_TIMESTAMP)
              ),
              0
            )::BIGINT AS current_month_volume,
            COALESCE(
              SUM(t.amount) FILTER (
                WHERE t.destination_user_id = $1
                  AND t.status = 'SUCCESS'
                  AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
                  AND date_trunc('month', t.created_at) = date_trunc('month', CURRENT_TIMESTAMP - INTERVAL '1 month')
              ),
              0
            )::BIGINT AS previous_month_volume
          FROM transactions t
          WHERE t.destination_user_id = $1
          `,
          [merchantId]
        ),
      ]);

    merchant.linked_banks = banksResult.rows || [];
    merchant.latest_decision = latestDecisionResult.rows[0] || null;
    merchant.api_stats = apiStatsResult.rows[0] || {
      total_requests: 0,
      success_requests: 0,
      last_api_call_at: null,
      last_payment_reference: null,
      last_transaction_id: null,
      last_webhook_status: null,
    };
    merchant.volume_stats = volumeStatsResult.rows[0] || {
      current_month_volume: 0,
      previous_month_volume: 0,
    };

    return merchant;
  },
};

module.exports = adminMerchantsRepository;
