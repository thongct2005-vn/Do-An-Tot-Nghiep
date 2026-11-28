-- Migration: Admin Postpaid Management, 4-Tier Late Fee Schedule, Auto Limit Penalty & Repeat-Overdue Proof Unlock
-- Additive & idempotent where possible; guards lock waits cleanly.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Mở rộng postpaid_wallets cho bộ đếm quá hạn, nguồn khóa và snapshot kỳ quá hạn
ALTER TABLE postpaid_wallets
  ADD COLUMN IF NOT EXISTS overdue_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lock_reason varchar(30),
  ADD COLUMN IF NOT EXISTS last_overdue_counted_cycle varchar(7),
  ADD COLUMN IF NOT EXISTS overdue_cycle_month varchar(7),
  ADD COLUMN IF NOT EXISTS overdue_cycle_due_date date,
  ADD COLUMN IF NOT EXISTS overdue_cycle_principal bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_limit_adjusted_cycle varchar(7);

ALTER TABLE postpaid_wallets
  DROP CONSTRAINT IF EXISTS chk_postpaid_wallets_overdue_count;
ALTER TABLE postpaid_wallets
  ADD CONSTRAINT chk_postpaid_wallets_overdue_count
    CHECK (overdue_count >= 0);

ALTER TABLE postpaid_wallets
  DROP CONSTRAINT IF EXISTS chk_postpaid_wallets_lock_reason;
ALTER TABLE postpaid_wallets
  ADD CONSTRAINT chk_postpaid_wallets_lock_reason
    CHECK (lock_reason IS NULL OR lock_reason IN ('USER_FREEZE', 'ADMIN_FREEZE', 'OVERDUE_REPEAT'));

ALTER TABLE postpaid_wallets
  DROP CONSTRAINT IF EXISTS chk_postpaid_wallets_overdue_principal;
ALTER TABLE postpaid_wallets
  ADD CONSTRAINT chk_postpaid_wallets_overdue_principal
    CHECK (overdue_cycle_principal >= 0);

UPDATE postpaid_wallets
   SET lock_reason = 'USER_FREEZE'
 WHERE status = 'FROZEN'
   AND lock_reason IS NULL;

UPDATE postpaid_wallets
   SET overdue_count = GREATEST(1, overdue_count),
       last_overdue_counted_cycle = COALESCE(last_overdue_counted_cycle, current_cycle_month),
       overdue_cycle_month = COALESCE(overdue_cycle_month, current_cycle_month),
       overdue_cycle_due_date = COALESCE(overdue_cycle_due_date, due_date),
       overdue_cycle_principal = CASE
         WHEN overdue_cycle_principal = 0 AND billed_amount > 0 THEN billed_amount
         ELSE overdue_cycle_principal
       END
 WHERE status = 'PAST_DUE';

-- 2. Mở rộng postpaid_entries hỗ trợ nhiều bậc LATE_FEE trong một kỳ (ghi bù chênh lệch theo bậc)
ALTER TABLE postpaid_entries
  ADD COLUMN IF NOT EXISTS late_fee_tier smallint;

ALTER TABLE postpaid_entries
  DROP CONSTRAINT IF EXISTS chk_postpaid_entries_late_fee_tier;
ALTER TABLE postpaid_entries
  ADD CONSTRAINT chk_postpaid_entries_late_fee_tier
    CHECK (late_fee_tier IS NULL OR (late_fee_tier BETWEEN 1 AND 4));

UPDATE postpaid_entries
   SET late_fee_tier = 1
 WHERE action = 'LATE_FEE'
   AND late_fee_tier IS NULL;

DROP INDEX IF EXISTS uk_postpaid_late_fee_cycle;
CREATE UNIQUE INDEX IF NOT EXISTS uk_postpaid_late_fee_cycle_tier
  ON postpaid_entries (user_id, cycle_month, late_fee_tier)
  WHERE action = 'LATE_FEE';

CREATE INDEX IF NOT EXISTS idx_postpaid_entries_created_action
  ON postpaid_entries (created_at DESC, id DESC);

-- 3. Bảng yêu cầu mở lại ví trả sau kèm ảnh chứng minh thu nhập
CREATE TABLE IF NOT EXISTS postpaid_unlock_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  user_note text,
  proof_image_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  overdue_count_snapshot integer NOT NULL DEFAULT 0 CHECK (overdue_count_snapshot >= 0),
  credit_limit_snapshot bigint NOT NULL CHECK (credit_limit_snapshot >= 0),
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_postpaid_unlock_pending_user
  ON postpaid_unlock_requests (user_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_postpaid_unlock_requests_status_created
  ON postpaid_unlock_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_postpaid_unlock_requests_user_created
  ON postpaid_unlock_requests (user_id, created_at DESC);

-- 4. Mở rộng chk_admin_change_action trên admin_user_change_history
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
      'POSTPAID_WALLET_FROZEN',
      'POSTPAID_WALLET_UNFROZEN',
      'POSTPAID_LIMIT_ADJUSTED',
      'POSTPAID_UNLOCK_APPROVED',
      'POSTPAID_UNLOCK_REJECTED',
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

-- 5. Chuyển cấu hình POSTPAID_CONFIG sang hạn mức mặc định >= 2.000.000đ và 4 bậc phí chậm trả (bỏ min_late_fee)
UPDATE system_configs
   SET value = (
         (value - 'late_fee_bps' - 'min_late_fee')
         || jsonb_build_object(
              'default_credit_limit',
              GREATEST(2000000, COALESCE((value->>'default_credit_limit')::bigint, 2000000)),
              'late_fee_tier1_bps',
              COALESCE((value->'late_fee_tier1_bps')::int, 525),
              'late_fee_tier2_bps',
              COALESCE((value->'late_fee_tier2_bps')::int, 1050),
              'late_fee_tier3_bps',
              COALESCE((value->'late_fee_tier3_bps')::int, 1575),
              'late_fee_tier4_bps',
              COALESCE((value->'late_fee_tier4_bps')::int, 2100)
            )
       ),
       description = 'Cấu hình Ví trả sau (hạn mức mặc định >= 2.000.000đ, chốt kỳ ngày 20, hạn trả ngày 5 tháng sau, phí trễ hạn 4 bậc 5.25%/10.5%/15.75%/21%, phí dịch vụ tháng 20.000đ miễn 1 GD đầu)',
       updated_at = NOW()
 WHERE key = 'POSTPAID_CONFIG';

COMMIT;
