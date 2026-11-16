-- Only for an unused additive migration. Once snapshots exist, retain the columns
-- and follow the application rollback/drain procedure; never erase fee evidence.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.payment_requests IN ACCESS EXCLUSIVE MODE;
DO $rollback$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_requests
    WHERE merchant_fee_amount_snapshot IS NOT NULL OR merchant_fee_rule_snapshot IS NOT NULL) THEN
    RAISE EXCEPTION 'Fee snapshots exist: retain columns and drain/cancel pending QR before application rollback';
  END IF;
END
$rollback$;
ALTER TABLE public.payment_requests
  DROP CONSTRAINT payment_requests_merchant_fee_snapshot_check,
  DROP COLUMN merchant_fee_amount_snapshot,
  DROP COLUMN merchant_fee_rule_snapshot;
COMMIT;
