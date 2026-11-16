-- Additive only. Keep legacy requests nullable; do not recalculate historical fees.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS merchant_fee_amount_snapshot bigint,
  ADD COLUMN IF NOT EXISTS merchant_fee_rule_snapshot jsonb;
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_requests'::regclass
      AND conname = 'payment_requests_merchant_fee_snapshot_check') THEN
    ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_merchant_fee_snapshot_check
    CHECK (
      (merchant_fee_amount_snapshot IS NULL AND merchant_fee_rule_snapshot IS NULL)
      OR (
        merchant_fee_amount_snapshot IS NOT NULL AND merchant_fee_rule_snapshot IS NOT NULL
        AND merchant_fee_amount_snapshot >= 0 AND merchant_fee_amount_snapshot <= amount
        AND jsonb_typeof(merchant_fee_rule_snapshot) = 'object'
      )
    ) NOT VALID;
  END IF;
END
$migration$;
COMMIT;
-- Existing rows have both fields NULL. Validate separately during release if needed
-- to avoid a table scan while the ADD COLUMN lock is held.
