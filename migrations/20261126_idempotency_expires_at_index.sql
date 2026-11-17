-- Migration: Đánh index theo expires_at để job dọn idempotency_keys quá hạn chạy nhanh, không full-scan.
-- Additive & idempotent: an toàn chạy lại nhiều lần.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON public.idempotency_keys (expires_at)
  WHERE expires_at IS NOT NULL;

COMMIT;

