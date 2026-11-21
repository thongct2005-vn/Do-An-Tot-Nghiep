-- Migration: Allow SYSTEM_CONFIG_UPDATED audit action on admin_user_change_history
-- Safe additive migration for system configuration admin module (idempotent).

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE admin_user_change_history IN ACCESS EXCLUSIVE MODE;

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
      'SYSTEM_CONFIG_UPDATED',
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
