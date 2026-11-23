// merchants.helpers.js: Các biểu thức SQL lọc Merchant và hàm định dạng mã, tên viết tắt, ẩn api_key cho Admin Merchants.

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
const LINKED_EXPR = `(u.status = 'ACTIVE' AND NOT u.credentials_revoked AND ${CONFIGURED_EXPR})`;
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
    WHEN u.credentials_revoked THEN 'LOCKED'
    WHEN u.status IN ('SUSPENDED', 'BLOCKED') THEN 'LOCKED'
    WHEN u.status IS DISTINCT FROM 'ACTIVE' THEN 'NOT_CONNECTED'
    WHEN u.api_key IS NULL OR u.secret_key IS NULL THEN 'PENDING_KEY'
    WHEN NOT ${CONFIGURED_EXPR} THEN 'NOT_CONNECTED'
    ELSE 'LINKED'
  END
`;

function buildMerchantFilterClause({
  search,
  tab,
  approvalStatus,
  status,
  apiStatus,
  startDate,
  endDate,
}) {
  const conditions = ["u.role = 'MERCHANT'"];
  const params = [];

  if (tab && tab !== "ALL") {
    if (tab === "LINKED") {
      conditions.push(LINKED_EXPR);
    } else if (tab === "PENDING") {
      conditions.push(PENDING_EXPR);
    } else if (tab === "UNCONFIGURED") {
      conditions.push(UNCONFIGURED_EXPR);
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
      conditions.push(`u.status = 'ACTIVE'`);
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
      )`,
    );
  }

  const whereClause = conditions.join(" AND ");
  const needKycInFilter = Boolean(
    tab === "PENDING" ||
      (approvalStatus && approvalStatus !== "ALL") ||
      status === "PENDING_ACTIVATION" ||
      status === "DISABLED" ||
      (search && search.trim() !== ""),
  );

  return { whereClause, params, needKycInFilter };
}

const CREDENTIAL_AUDIT_ACTIONS = ["ISSUED", "ROTATED", "REVOKED", "REISSUED"].map(
  (x) => `MERCHANT_CREDENTIALS_${x}`,
);

function formatMerchantCode(id) {
  const clean = String(id || "").replace(/-/g, "").toUpperCase();
  return `MER-${clean.slice(-5)}`;
}

function formatUserCode(id) {
  const clean = String(id || "").replace(/-/g, "").toUpperCase();
  return `USR-${clean.slice(-5)}`;
}

function getInitials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "MC";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function maskApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  if (apiKey.length <= 12) {
    return `${apiKey.slice(0, 4)}...`;
  }
  return `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`;
}

module.exports = {
  KYC_LATERAL_JOIN,
  APPROVAL_STATUS_EXPR,
  CONFIGURED_EXPR,
  LINKED_EXPR,
  UNCONFIGURED_EXPR,
  SUSPENDED_EXPR,
  PENDING_EXPR,
  OPERATIONAL_STATUS_EXPR,
  API_STATUS_EXPR,
  buildMerchantFilterClause,
  CREDENTIAL_AUDIT_ACTIONS,
  formatMerchantCode,
  formatUserCode,
  getInitials,
  maskApiKey,
};
