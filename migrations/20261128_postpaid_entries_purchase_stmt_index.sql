-- Migration: Tạo partial index cho postpaid_entries (PURCHASE & STATEMENT_CLOSE)
-- Giúp job chốt sao kê (closeBillingCycle) kiểm tra điều kiện tính phí dịch vụ nhanh bằng index-only scan + dừng sớm.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_postpaid_entries_user_purchase_stmt
  ON public.postpaid_entries (user_id, created_at DESC, id DESC)
  WHERE action IN ('PURCHASE', 'STATEMENT_CLOSE');

COMMIT;

