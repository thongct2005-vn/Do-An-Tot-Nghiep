-- Rollback for 20261127_audit_outbox_tx_partial_index.sql
-- IMPORTANT: DROP INDEX CONCURRENTLY phải chạy ngoài transaction block (autocommit).

DROP INDEX CONCURRENTLY IF EXISTS public.idx_audit_outbox_tx_id;
