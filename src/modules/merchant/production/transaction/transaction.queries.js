// transaction.queries.js: Các đoạn SQL JOIN và bộ lọc nâng cao dựng động cho lịch sử giao dịch Merchant.
const POSTPAID_PAYER_JOIN = `
      LEFT JOIN LATERAL (
        SELECT pe.user_id, u.full_name, u.phone
          FROM postpaid_entries pe
          JOIN users u ON u.id = pe.user_id
         WHERE pe.tx_id = t.id AND pe.action = 'PURCHASE'
         LIMIT 1
      ) pp ON true`;

const FUNDING_SOURCE_SELECT = `'Ví LumaPay'::text AS funding_source`;

function buildMerchantExtraFilters({
  direction = null,
  status = null,
  minAmount = null,
  maxAmount = null,
  fundingSource = null,
  startIndex,
}) {
  const hasDirection = Boolean(direction && String(direction).trim());
  const hasStatus = Boolean(status && String(status).trim());
  const hasMinAmount = minAmount !== null && minAmount !== undefined;
  const hasMaxAmount = maxAmount !== null && maxAmount !== undefined;
  const hasFundingSource = Boolean(fundingSource && String(fundingSource).trim());

  const iDirFlag = startIndex;
  const iDirVal = startIndex + 1;
  const iStatusFlag = startIndex + 2;
  const iStatusVal = startIndex + 3;
  const iMinFlag = startIndex + 4;
  const iMinVal = startIndex + 5;
  const iMaxFlag = startIndex + 6;
  const iMaxVal = startIndex + 7;
  const iFundFlag = startIndex + 8;
  const iFundVal = startIndex + 9;

  const sql = `
        AND (
          $${iDirFlag}::boolean = false
          OR (
            CASE
              WHEN t.transaction_type = 'TOPUP' THEN 'IN'
              WHEN t.source_user_id = $1 THEN 'OUT'
              ELSE 'IN'
            END
          ) = $${iDirVal}::text
        )
        AND ($${iStatusFlag}::boolean = false OR t.status = $${iStatusVal}::text)
        AND ($${iMinFlag}::boolean = false OR t.amount >= $${iMinVal}::bigint)
        AND ($${iMaxFlag}::boolean = false OR t.amount <= $${iMaxVal}::bigint)
        AND (
          $${iFundFlag}::boolean = false
          OR (
            CASE
              WHEN t.linked_bank_account_id IS NOT NULL AND lba.user_id = $1 THEN 'BANK'
              ELSE 'MAIN_WALLET'
            END
          ) = $${iFundVal}::text
        )`;

  const values = [
    hasDirection,
    hasDirection ? String(direction).trim().toUpperCase() : null,
    hasStatus,
    hasStatus ? String(status).trim().toUpperCase() : null,
    hasMinAmount,
    hasMinAmount ? Number(minAmount) : null,
    hasMaxAmount,
    hasMaxAmount ? Number(maxAmount) : null,
    hasFundingSource,
    hasFundingSource ? String(fundingSource).trim().toUpperCase() : null,
  ];

  return { sql, values };
}

module.exports = {
  POSTPAID_PAYER_JOIN,
  FUNDING_SOURCE_SELECT,
  buildMerchantExtraFilters,
};

