-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a BEGIN ... COMMIT transaction block.
-- Run each statement independently (autocommit) or execute backend/scripts/create_report_perf_indexes.js.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fee_ledger_qr_created_tx
  ON public.fee_ledger_entries (created_at, transaction_id)
  INCLUDE (amount)
  WHERE fee_type = 'QR_FEE';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_source_created_id
  ON public.transactions (source_user_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_dest_created_id_inc
  ON public.transactions (destination_user_id, created_at DESC, id DESC)
  INCLUDE (amount, merchant_fee, transaction_type, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_merchant_success_created
  ON public.transactions (created_at, destination_user_id, transaction_type)
  INCLUDE (amount, merchant_fee)
  WHERE transaction_type IN ('PAYMENT', 'TRANSFER')
    AND status IN ('SUCCESS', 'COMPLETED');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pr_gateway_created_cohort
  ON public.payment_requests (created_at, destination_user_id)
  INCLUDE (status)
  WHERE order_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pr_dest_created_inc
  ON public.payment_requests (destination_user_id, created_at DESC)
  INCLUDE (status, reference_code, transaction_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pr_transaction_id_inc
  ON public.payment_requests (transaction_id)
  INCLUDE (reference_code)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_change_tx_id_created
  ON public.admin_user_change_history ((new_values->>'transaction_id'), created_at DESC, id DESC)
  WHERE (new_values->>'transaction_id') IS NOT NULL;
