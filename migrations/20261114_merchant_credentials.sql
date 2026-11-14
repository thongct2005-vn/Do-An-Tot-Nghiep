-- Additive migration. Run separately through the database release process.
-- Existing revoked flags, secrets, balances and terminal payment states are preserved.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS credentials_revoked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credentials_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS credentials_revision bigint;
-- Capture the currently deployed revision for legacy Merchant requests once.
UPDATE public.payment_requests pr
SET credentials_revision = u.credentials_revision
FROM public.users u
WHERE pr.destination_user_id = u.id AND u.role = 'MERCHANT'
  AND pr.credentials_revision IS NULL;

DO $migration$
DECLARE current_expression text;
BEGIN
  LOCK TABLE public.admin_user_change_history IN ACCESS EXCLUSIVE MODE;
  SELECT pg_get_expr(conbin, conrelid) INTO current_expression
  FROM pg_constraint WHERE conrelid = 'public.admin_user_change_history'::regclass
    AND conname = 'chk_admin_change_action' AND contype = 'c';
  IF current_expression IS NOT NULL AND NOT (
    position('''MERCHANT_CREDENTIALS_ISSUED''' in current_expression) > 0 AND
    position('''MERCHANT_CREDENTIALS_ROTATED''' in current_expression) > 0 AND
    position('''MERCHANT_CREDENTIALS_REVOKED''' in current_expression) > 0 AND
    position('''MERCHANT_CREDENTIALS_REISSUED''' in current_expression) > 0
  ) THEN
    ALTER TABLE public.admin_user_change_history DROP CONSTRAINT chk_admin_change_action;
    EXECUTE format('ALTER TABLE public.admin_user_change_history ADD CONSTRAINT chk_admin_change_action CHECK ((%s) OR action IN (''MERCHANT_CREDENTIALS_ISSUED'', ''MERCHANT_CREDENTIALS_ROTATED'', ''MERCHANT_CREDENTIALS_REVOKED'', ''MERCHANT_CREDENTIALS_REISSUED''))', current_expression);
  END IF;
END
$migration$;
COMMIT;
