-- Partial expression index bảo vệ truy vấn timeline trên audit_outbox khi bảng tăng kích thước.
-- IMPORTANT: CREATE INDEX CONCURRENTLY không được chạy trong BEGIN ... COMMIT transaction block.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_outbox_tx_id
  ON public.audit_outbox ((payload->>'transaction_id'))
  WHERE (payload->>'transaction_id') IS NOT NULL;
