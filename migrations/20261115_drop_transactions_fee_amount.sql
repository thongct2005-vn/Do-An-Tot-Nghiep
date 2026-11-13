-- Drop redundant fee_amount column from transactions.
-- Sender/withdraw fees are stored in `fee`, merchant inbound fees are stored in `merchant_fee`,
-- and detailed breakdowns live in `fee_rate_snapshot` and `fee_ledger_entries`.
ALTER TABLE transactions
  DROP COLUMN IF EXISTS fee_amount;

