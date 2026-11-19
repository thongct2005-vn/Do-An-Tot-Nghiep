-- Xóa các index trùng hoàn toàn (Nhóm 1) và bị bao phủ hoàn toàn (Nhóm 2) sau kiểm chứng EXPLAIN & pg_depend.
-- IMPORTANT: DROP INDEX CONCURRENTLY không được chạy trong BEGIN ... COMMIT transaction block.
-- Thực thi ngoài transaction block (autocommit) bằng backend/scripts/run_concurrent_index_migration.js.
-- Lưu ý: Nhóm 3 (idx_transactions_source_time, idx_transactions_dest_time, idx_pri_product,
-- idx_transactions_type_status, idx_audit_outbox_pending, idx_audit_outbox_tx_id) được GIỮ NGUYÊN.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_payment_request_items_pr_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_payment_requests_reference_code;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_payment_requests_transaction_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_payment_requests_destination_user;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_transactions_dest_payment;
