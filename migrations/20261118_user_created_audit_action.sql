-- Additive migration: allow USER_CREATED in admin_user_change_history.action
-- Preserves all existing data and allowed actions in chk_admin_change_action.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE current_expression text;
BEGIN
  LOCK TABLE public.admin_user_change_history IN ACCESS EXCLUSIVE MODE;
  SELECT pg_get_expr(conbin, conrelid) INTO current_expression
  FROM pg_constraint
  WHERE conrelid = 'public.admin_user_change_history'::regclass
    AND conname = 'chk_admin_change_action'
    AND contype = 'c';

  IF current_expression IS NOT NULL AND position('''USER_CREATED''' in current_expression) = 0 THEN
    ALTER TABLE public.admin_user_change_history DROP CONSTRAINT chk_admin_change_action;
    EXECUTE format(
      'ALTER TABLE public.admin_user_change_history ADD CONSTRAINT chk_admin_change_action CHECK ((%s) OR action IN (''USER_CREATED''))',
      current_expression
    );
  END IF;
END
$migration$;

COMMIT;
