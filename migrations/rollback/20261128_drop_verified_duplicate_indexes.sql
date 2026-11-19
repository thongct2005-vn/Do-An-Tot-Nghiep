-- Rollback cho 20261128_drop_verified_duplicate_indexes.sql & 20261128_drop_uk_users_phone_constraint.sql.
-- IMPORTANT: Chạy từng lệnh CREATE INDEX CONCURRENTLY ngoài transaction block (autocommit).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_request_items_pr_id
  ON public.payment_request_items (payment_request_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_requests_reference_code
  ON public.payment_requests (reference_code);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_requests_transaction_id
  ON public.payment_requests (transaction_id)
  WHERE (transaction_id IS NOT NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_requests_destination_user
  ON public.payment_requests (destination_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_dest_payment
  ON public.transactions (destination_user_id)
  WHERE (transaction_type = 'PAYMENT'::transaction_type_enum);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uk_users_phone
  ON public.users (phone);

-- Gắn lại UNIQUE CONSTRAINT sử dụng index vừa tạo (chỉ khóa rất ngắn):
-- ALTER TABLE public.users ADD CONSTRAINT uk_users_phone UNIQUE USING INDEX uk_users_phone;
