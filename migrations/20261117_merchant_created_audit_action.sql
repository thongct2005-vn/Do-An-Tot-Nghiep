-- Additive migration: add users.must_change_password and allow MERCHANT_CREATED in admin_user_change_history.action
-- Preserves all existing data and allowed actions in chk_admin_change_action.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

DO $migration$
DECLARE current_expression text;
BEGIN
  LOCK TABLE public.admin_user_change_history IN ACCESS EXCLUSIVE MODE;
  SELECT pg_get_expr(conbin, conrelid) INTO current_expression
  FROM pg_constraint
  WHERE conrelid = 'public.admin_user_change_history'::regclass
    AND conname = 'chk_admin_change_action'
    AND contype = 'c';

  IF current_expression IS NOT NULL AND position('''MERCHANT_CREATED''' in current_expression) = 0 THEN
    ALTER TABLE public.admin_user_change_history DROP CONSTRAINT chk_admin_change_action;
    EXECUTE format(
      'ALTER TABLE public.admin_user_change_history ADD CONSTRAINT chk_admin_change_action CHECK ((%s) OR action IN (''MERCHANT_CREATED''))',
      current_expression
    );
  END IF;
END
$migration$;

COMMIT;