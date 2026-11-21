-- Rollback: Restore chk_admin_change_action to pre-20261130 allowed actions.
-- Refuses rollback if SYSTEM_CONFIG_UPDATED audit records exist so audit trail is never silently dropped.

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE admin_user_change_history IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM admin_user_change_history WHERE action = 'SYSTEM_CONFIG_UPDATED'
  ) THEN
    RAISE EXCEPTION 'Cannot rollback 20261130_system_config_audit_action: existing SYSTEM_CONFIG_UPDATED rows present in admin_user_change_history';
  END IF;
END $$;

ALTER TABLE admin_user_change_history
  DROP CONSTRAINT IF EXISTS chk_admin_change_action;

ALTER TABLE admin_user_change_history
  ADD CONSTRAINT chk_admin_change_action CHECK (
    action IN (
      'USER_PROFILE_UPDATED',
      'USER_BLOCKED',
      'USER_UNBLOCKED',
      'USER_LOGIN_UNLOCKED',
      'USER_CREATED',
      'MERCHANT_CREATED',
      'MERCHANT_BLOCKED',
      'MERCHANT_UNBLOCKED',
      'MERCHANT_CREDENTIALS_ISSUED',
      'MERCHANT_CREDENTIALS_ROTATED',
      'MERCHANT_CREDENTIALS_REVOKED',
      'MERCHANT_CREDENTIALS_REISSUED',
      'MERCHANT_FEE_CONFIG_UPDATED',
      'SYSTEM_FEE_CONFIG_UPDATED',
      'USER_SESSIONS_REVOKED',
      'USER_QR_REGENERATED',
      'ADMIN_OP_P2P',
      'ADMIN_OP_TOPUP',
      'ADMIN_OP_WITHDRAW',
      'ADMIN_OP_REVERSAL',
      'DISPUTE_OPENED',
      'DISPUTE_UPDATED',
      'DISPUTE_RESOLVED'
    )
  );

COMMIT;
