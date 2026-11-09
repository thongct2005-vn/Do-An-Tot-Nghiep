const pool = require("../../config/database");

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

const OPERATIONAL_STATUS_EXPR = `
  CASE
    WHEN COALESCE(k.approval_status, 'PENDING') = 'PENDING' THEN 'PENDING_ACTIVATION'
    WHEN COALESCE(k.approval_status, 'PENDING') = 'REJECTED' THEN 'DISABLED'
    WHEN u.status IN ('SUSPENDED', 'BLOCKED') THEN 'SUSPENDED'
    ELSE 'ACTIVE'
  END
`;

const API_STATUS_EXPR = `
  CASE
    WHEN u.status IN ('SUSPENDED', 'BLOCKED') THEN 'LOCKED'
    WHEN COALESCE(k.approval_status, 'PENDING') <> 'APPROVED' THEN 'NOT_CONNECTED'
    WHEN u.api_key IS NULL OR u.secret_key IS NULL THEN 'PENDING_KEY'
    ELSE 'LINKED'
  END
`;

const adminMerchantsRepository = {
  async getMerchantStats() {
    const result = await pool.query(`
      SELECT
        COUNT(*)::INT AS total_merchants,
        COUNT(*) FILTER (
          WHERE ${APPROVAL_STATUS_EXPR} = 'APPROVED'
            AND u.status = 'ACTIVE'
            AND u.api_key IS NOT NULL
            AND u.secret_key IS NOT NULL
        )::INT AS linked_merchants,
        COUNT(*) FILTER (
          WHERE ${APPROVAL_STATUS_EXPR} = 'PENDING'
        )::INT AS pending_merchants,
        COUNT(*) FILTER (
          WHERE ${APPROVAL_STATUS_EXPR} = 'APPROVED'
            AND u.status = 'ACTIVE'
            AND (u.api_key IS NULL OR u.secret_key IS NULL OR u.call_back_url IS NULL OR TRIM(u.call_back_url) = '')
        )::INT AS unconfigured_merchants,
        COUNT(*) FILTER (
          WHERE u.status IN ('SUSPENDED', 'BLOCKED')
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
  }) {
    const conditions = ["u.role = 'MERCHANT'"];
    const params = [];

    if (tab && tab !== "ALL") {
      if (tab === "LINKED") {
        conditions.push(
          `${APPROVAL_STATUS_EXPR} = 'APPROVED' AND u.status = 'ACTIVE' AND u.api_key IS NOT NULL AND u.secret_key IS NOT NULL`
        );
      } else if (tab === "PENDING") {
        conditions.push(`${APPROVAL_STATUS_EXPR} = 'PENDING'`);
      } else if (tab === "UNCONFIGURED") {
        conditions.push(
          `${APPROVAL_STATUS_EXPR} = 'APPROVED' AND u.status = 'ACTIVE' AND (u.api_key IS NULL OR u.secret_key IS NULL OR u.call_back_url IS NULL OR TRIM(u.call_back_url) = '')`
        );
      } else if (tab === "SUSPENDED") {
        conditions.push(`u.status IN ('SUSPENDED', 'BLOCKED')`);
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
          `u.status = 'ACTIVE' AND ${APPROVAL_STATUS_EXPR} = 'APPROVED'`
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
      conditions.push(`u.created_at <= $${params.length}`);
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

    const countResult = await pool.query(
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

    const itemsResult = await pool.query(
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
      ORDER BY u.created_at DESC
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
