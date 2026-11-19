-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a BEGIN ... COMMIT transaction block.
-- Run this statement in autocommit mode or execute backend/scripts/create_postpaid_fee_index.js.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_ledger_postpaid_created_tx
  ON public.fee_ledger_entries (created_at, fee_type, transaction_id)
  INCLUDE (amount)
  WHERE fee_type IN ('POSTPAID_SERVICE_FEE', 'POSTPAID_LATE_FEE');
