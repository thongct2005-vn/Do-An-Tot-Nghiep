-- Apply before deploying the ADMIN Merchant status endpoint.
-- Extend the observed constraint while preserving every existing permitted action.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $migration$
DECLARE
  current_expression text;
BEGIN
  LOCK TABLE public.admin_user_change_history IN ACCESS EXCLUSIVE MODE;
  SELECT pg_get_expr(conbin, conrelid) INTO current_expression
    FROM pg_constraint
    WHERE conrelid = 'public.admin_user_change_history'::regclass
      AND conname = 'chk_admin_change_action' AND contype = 'c';

  IF current_expression IS NULL THEN
    RAISE NOTICE 'No chk_admin_change_action constraint; no migration required';
  ELSIF position('''MERCHANT_BLOCKED''' in current_expression) > 0
    AND position('''MERCHANT_UNBLOCKED''' in current_expression) > 0 THEN
    RAISE NOTICE 'Merchant status audit actions already supported';
  ELSE
    ALTER TABLE public.admin_user_change_history DROP CONSTRAINT chk_admin_change_action;
    EXECUTE format(
      'ALTER TABLE public.admin_user_change_history ADD CONSTRAINT chk_admin_change_action CHECK ((%s) OR action IN (''MERCHANT_BLOCKED'', ''MERCHANT_UNBLOCKED''))',
      current_expression
    );
  END IF;
END
$migration$;
COMMIT;
