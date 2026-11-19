-- Migration: Đánh index theo expires_at để job dọn idempotency_keys quá hạn chạy nhanh, không full-scan.
-- IMPORTANT: CREATE INDEX CONCURRENTLY không được chạy trong BEGIN ... COMMIT transaction block.
-- Thực thi ngoài transaction block (autocommit) hoặc qua backend/scripts/run_concurrent_index_migration.js.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_idempotency_keys_expires_at
  ON public.idempotency_keys (expires_at)
  WHERE expires_at IS NOT NULL;
