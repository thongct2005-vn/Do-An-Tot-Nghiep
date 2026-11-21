-- Rollback: Revert 20261201_postpaid_admin_and_lifecycle migration.
-- Refuses rollback if new audit records or multi-tier LATE_FEE rows exist to prevent data loss.

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE admin_user_change_history IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM admin_user_change_history
     WHERE action IN (
       'POSTPAID_WALLET_FROZEN',
       'POSTPAID_WALLET_UNFROZEN',
       'POSTPAID_LIMIT_ADJUSTED',
       'POSTPAID_UNLOCK_APPROVED',
       'POSTPAID_UNLOCK_REJECTED'
     )
  ) THEN
    RAISE EXCEPTION 'Cannot rollback 20261201_postpaid_admin_and_lifecycle: existing POSTPAID_* audit rows present in admin_user_change_history';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM postpaid_entries
     WHERE action = 'LATE_FEE'
     GROUP BY user_id, cycle_month
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot rollback 20261201_postpaid_admin_and_lifecycle: multi-tier LATE_FEE entries exist in postpaid_entries';
  END IF;
END $$;

-- Restore POSTPAID_CONFIG JSONB schema to pre-20261201 shape
UPDATE system_configs
   SET value = (
         (value - 'late_fee_tier1_bps' - 'late_fee_tier2_bps' - 'late_fee_tier3_bps' - 'late_fee_tier4_bps')
         || '{"late_fee_bps": 200, "min_late_fee": 10000}'::jsonb
       ),
       description = 'Cấu hình Ví trả sau (hạn mức mặc định 2.000.000đ, tài khoản tối thiểu 24h, chốt kỳ ngày 20, hạn trả ngày 5 tháng sau, phí trễ hạn 2% min 10.000đ, phí dịch vụ tháng 20.000đ miễn 1 GD đầu)',
       updated_at = NOW()
 WHERE key = 'POSTPAID_CONFIG';

-- Restore chk_admin_change_action to pre-20261201 actions
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

-- Drop unlock request table & indexes
DROP TABLE IF EXISTS postpaid_unlock_requests;

-- Restore single-entry uk_postpaid_late_fee_cycle
DROP INDEX IF EXISTS uk_postpaid_late_fee_cycle_tier;
DROP INDEX IF EXISTS idx_postpaid_entries_created_action;
ALTER TABLE postpaid_entries
  DROP CONSTRAINT IF EXISTS chk_postpaid_entries_late_fee_tier;
ALTER TABLE postpaid_entries
  DROP COLUMN IF EXISTS late_fee_tier;
CREATE UNIQUE INDEX IF NOT EXISTS uk_postpaid_late_fee_cycle
  ON postpaid_entries (user_id, cycle_month)
  WHERE action = 'LATE_FEE';

-- Drop postpaid_wallets extended columns & constraints
ALTER TABLE postpaid_wallets
  DROP CONSTRAINT IF EXISTS chk_postpaid_wallets_overdue_count,
  DROP CONSTRAINT IF EXISTS chk_postpaid_wallets_lock_reason,
  DROP CONSTRAINT IF EXISTS chk_postpaid_wallets_overdue_principal;

ALTER TABLE postpaid_wallets
  DROP COLUMN IF EXISTS overdue_count,
  DROP COLUMN IF EXISTS lock_reason,
  DROP COLUMN IF EXISTS last_overdue_counted_cycle,
  DROP COLUMN IF EXISTS overdue_cycle_month,
  DROP COLUMN IF EXISTS overdue_cycle_due_date,
  DROP COLUMN IF EXISTS overdue_cycle_principal,
  DROP COLUMN IF EXISTS last_limit_adjusted_cycle;

COMMIT;
