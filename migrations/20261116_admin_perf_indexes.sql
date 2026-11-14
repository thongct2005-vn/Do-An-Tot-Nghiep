-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a BEGIN ... COMMIT transaction block.
-- Run each statement independently (autocommit) or execute backend/scripts/create_admin_perf_indexes.js.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_created_at_id
  ON public.transactions (created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role_created_at_id
  ON public.users (role, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_kyc_user_latest
  ON public.user_kyc (user_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lba_user_default_created_at
  ON public.linked_bank_accounts (user_id, is_default DESC, created_at DESC);
