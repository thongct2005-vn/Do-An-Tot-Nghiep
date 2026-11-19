-- Safe rollback for 20261125_admin_reversal_audit.sql.
-- Refuses to remove ADMIN_OP_REVERSAL if any reversal audit records already exist.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.admin_user_change_history IN ACCESS EXCLUSIVE MODE;

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.admin_user_change_history
    WHERE action = 'ADMIN_OP_REVERSAL'
  ) THEN
    RAISE EXCEPTION 'ADMIN_OP_REVERSAL audit records exist: retain constraint and index rather than erasing audit evidence';
  END IF;
END
$rollback$;

DROP INDEX IF EXISTS public.uk_admin_reversal_original_tx;

ALTER TABLE public.admin_user_change_history
  DROP CONSTRAINT IF EXISTS chk_admin_change_action;

ALTER TABLE public.admin_user_change_history
  ADD CONSTRAINT chk_admin_change_action
  CHECK (
    (
      (action)::text = ANY (
        ARRAY[
          'USER_PROFILE_UPDATED'::text,
          'USER_BLOCKED'::text,
          'USER_UNBLOCKED'::text,
          'USER_LOGIN_UNLOCKED'::text,
          'USER_SESSIONS_REVOKED'::text,
          'USER_QR_REGENERATED'::text,
          'MERCHANT_BLOCKED'::text,
          'MERCHANT_UNBLOCKED'::text,
          'MERCHANT_FEE_CONFIG_UPDATED'::text,
          'SYSTEM_FEE_CONFIG_UPDATED'::text,
          'ADMIN_OP_P2P'::text,
          'ADMIN_OP_TOPUP'::text,
          'ADMIN_OP_WITHDRAW'::text,
          'DISPUTE_OPENED'::text,
          'DISPUTE_UPDATED'::text,
          'DISPUTE_RESOLVED'::text
        ]
      )
    )
    OR (
      (action)::text = ANY (
        ARRAY[
          ('MERCHANT_CREDENTIALS_ISSUED'::character varying)::text,
          ('MERCHANT_CREDENTIALS_ROTATED'::character varying)::text,
          ('MERCHANT_CREDENTIALS_REVOKED'::character varying)::text,
          ('MERCHANT_CREDENTIALS_REISSUED'::character varying)::text
        ]
      )
    )
    OR ((action)::text = 'MERCHANT_CREATED'::text)
    OR ((action)::text = 'USER_CREATED'::text)
  );

COMMIT;
