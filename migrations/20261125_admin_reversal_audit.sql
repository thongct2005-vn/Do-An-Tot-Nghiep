-- Additive migration: allow ADMIN_OP_REVERSAL in admin_user_change_history.action
-- and enforce at most one reversal audit record per original_transaction_id.
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

  IF current_expression IS NOT NULL AND position('''ADMIN_OP_REVERSAL''' IN current_expression) = 0 THEN
    ALTER TABLE public.admin_user_change_history DROP CONSTRAINT chk_admin_change_action;
    EXECUTE format(
      'ALTER TABLE public.admin_user_change_history ADD CONSTRAINT chk_admin_change_action CHECK ((%s) OR action IN (''ADMIN_OP_REVERSAL''))',
      current_expression
    );
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS uk_admin_reversal_original_tx
  ON public.admin_user_change_history ((new_values->>'original_transaction_id'))
  WHERE action = 'ADMIN_OP_REVERSAL'
    AND (new_values->>'original_transaction_id') IS NOT NULL;

COMMIT;

-- Rollback (chi chay neu chua phat sinh ban ghi action = 'ADMIN_OP_REVERSAL' hoac da xu ly luu tru):
-- DROP INDEX IF EXISTS public.uk_admin_reversal_original_tx;
-- (Khoi phuc chk_admin_change_action khong bao gom 'ADMIN_OP_REVERSAL' theo snapshot truoc khi chay migration).
