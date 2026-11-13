-- Migration: Flexible Fee System, Merchant Overrides, Withdraw Quota Ledger, PAST_DUE Monthly Plan & System Fee Wallet
-- Safe for existing 9.6M+ rows on transactions (metadata-only ADD COLUMN without full-table rewrite).

BEGIN;

-- 1. Ví thu phí hệ thống (SYSTEM_FEE_WALLET) trong bảng users để tổng tiền toàn hệ thống luôn khớp khi đối soát
--    (users.phone là varchar(10) nên dùng mã định danh 'SYS_FEE_01' + full_name = 'SYSTEM_FEE_WALLET')
INSERT INTO users (
  id, role, full_name, email, phone, status, balance, created_at, updated_at
)
VALUES (
  '00000000-0000-7000-8000-000000000001'::uuid,
  'SYSTEM',
  'SYSTEM_FEE_WALLET',
  'system_fee_wallet@system.internal',
  'SYS_FEE_01',
  'ACTIVE',
  0,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- 2. Mở rộng cột snapshot phí trên transactions (nullable cho dữ liệu cũ -> metadata-only, không khóa bảng lâu)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS fee_amount bigint,
  ADD COLUMN IF NOT EXISTS fee_rate_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS net_amount bigint;

-- 3. Cập nhật cấu hình mặc định hệ thống (MERCHANT_FEE_CONFIG đổi gói tháng từ 299000 -> 300000, thêm các trường linh hoạt; thêm USER_FEE_CONFIG)
INSERT INTO system_configs (key, value, description, updated_at)
VALUES (
  'MERCHANT_FEE_CONFIG',
  '{
    "rate_bps": 100,
    "min_fee": 500,
    "max_fee": 50000,
    "free_threshold_amount": 0,
    "withdraw_fee_bps": 0,
    "withdraw_free_quota_per_month": 0,
    "monthly_plan_enabled": false,
    "monthly_plan_fee": 300000,
    "monthly_grace_days": 7,
    "tiers": []
  }'::jsonb,
  'Cấu hình biểu phí mặc định cho Merchant (bps: 100 = 1%, VND số nguyên, monthly_plan_enabled=false mặc định)',
  NOW()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = NOW();

INSERT INTO system_configs (key, value, description, updated_at)
VALUES (
  'USER_FEE_CONFIG',
  '{
    "rate_bps": 0,
    "min_fee": 0,
    "max_fee": null,
    "free_threshold_amount": 0,
    "withdraw_fee_bps": 0,
    "withdraw_free_quota_per_month": 0,
    "tiers": []
  }'::jsonb,
  'Cấu hình biểu phí mặc định cho User cuối (mặc định 0đ = miễn phí)',
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- 4. Mở rộng bảng trạng thái gói tháng của merchant để hỗ trợ PAST_DUE & thời gian ân hạn
ALTER TABLE merchant_fee_settings
  ADD COLUMN IF NOT EXISTS monthly_plan_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monthly_status varchar(20) NOT NULL DEFAULT 'INACTIVE',
  ADD COLUMN IF NOT EXISTS grace_until timestamptz,
  ADD COLUMN IF NOT EXISTS overdue_month_key varchar(7),
  ADD COLUMN IF NOT EXISTS overdue_amount bigint NOT NULL DEFAULT 0;

ALTER TABLE merchant_fee_settings
  DROP CONSTRAINT IF EXISTS chk_mfs_monthly_status;
ALTER TABLE merchant_fee_settings
  ADD CONSTRAINT chk_mfs_monthly_status
  CHECK (monthly_status IN ('INACTIVE', 'ACTIVE', 'PENDING_ACTIVATE', 'PAST_DUE'));

ALTER TABLE merchant_fee_settings
  DROP CONSTRAINT IF EXISTS chk_mfs_overdue_nonneg;
ALTER TABLE merchant_fee_settings
  ADD CONSTRAINT chk_mfs_overdue_nonneg
  CHECK (overdue_amount >= 0);

-- Migration an toàn cho bản ghi merchant_fee_settings hiện có:
-- giữ nguyên biểu phí giao dịch (1%, min 500, max 50.000), tắt gói tháng trừ khi được bật rõ ràng
UPDATE merchant_fee_settings
   SET fee_plan = 'PER_TRANSACTION',
       pending_fee_plan = NULL,
       expires_at = NULL,
       monthly_plan_enabled = false,
       monthly_status = 'INACTIVE',
       grace_until = NULL,
       overdue_month_key = NULL,
       overdue_amount = 0,
       updated_at = NOW()
 WHERE fee_plan = 'MONTHLY' OR monthly_plan_enabled = true;

-- 5. Bảng cấu hình biểu phí theo từng merchant có lịch sử effective_from (không hồi tố giao dịch cũ)
CREATE TABLE IF NOT EXISTS merchant_fee_schedules (
  id uuid PRIMARY KEY,
  merchant_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_from timestamptz NOT NULL DEFAULT NOW(),
  rate_bps integer CHECK (rate_bps IS NULL OR (rate_bps >= 0 AND rate_bps <= 10000)),
  min_fee bigint CHECK (min_fee IS NULL OR min_fee >= 0),
  max_fee bigint CHECK (max_fee IS NULL OR max_fee >= 0),
  max_fee_unbounded boolean NOT NULL DEFAULT false,
  free_threshold_amount bigint CHECK (free_threshold_amount IS NULL OR free_threshold_amount >= 0),
  withdraw_fee_bps integer CHECK (withdraw_fee_bps IS NULL OR (withdraw_fee_bps >= 0 AND withdraw_fee_bps <= 10000)),
  withdraw_free_quota_per_month bigint CHECK (withdraw_free_quota_per_month IS NULL OR withdraw_free_quota_per_month >= 0),
  monthly_plan_enabled boolean,
  monthly_plan_fee bigint CHECK (monthly_plan_fee IS NULL OR monthly_plan_fee >= 0),
  tiers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tiers) = 'array'),
  reason text,
  created_by_actor varchar(120),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (min_fee IS NULL OR max_fee IS NULL OR min_fee <= max_fee)
);

CREATE INDEX IF NOT EXISTS idx_merchant_fee_schedules_lookup
  ON merchant_fee_schedules (merchant_user_id, effective_from DESC, created_at DESC);

-- 6. Bảng theo dõi tổng tiền rút & doanh số trong tháng của user/merchant (Asia/Ho_Chi_Minh)
CREATE TABLE IF NOT EXISTS merchant_monthly_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_key varchar(7) NOT NULL,
  withdrawn_amount bigint NOT NULL DEFAULT 0 CHECK (withdrawn_amount >= 0),
  qr_gross_amount bigint NOT NULL DEFAULT 0 CHECK (qr_gross_amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, month_key)
);

-- 7. Bảng sổ cái thu phí hệ thống (immutable ledger, idempotent theo transaction_id + fee_type)
CREATE TABLE IF NOT EXISTS fee_ledger_entries (
  id uuid PRIMARY KEY,
  transaction_id varchar REFERENCES transactions(id) ON DELETE RESTRICT,
  merchant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  payer_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  fee_type varchar(30) NOT NULL CHECK (fee_type IN ('QR_FEE', 'USER_FEE', 'WITHDRAW_FEE', 'MONTHLY_PLAN_FEE')),
  amount bigint NOT NULL CHECK (amount >= 0),
  rate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  fee_wallet_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fee_wallet_balance_before bigint NOT NULL,
  fee_wallet_balance_after bigint NOT NULL,
  idempotency_key varchar(120),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, fee_type)
);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_merchant_created
  ON fee_ledger_entries (merchant_user_id, created_at DESC);

-- 8. Mở rộng constraint lịch sử thay đổi Admin để audit cấu hình phí
ALTER TABLE admin_user_change_history
  DROP CONSTRAINT IF EXISTS chk_admin_change_action;
ALTER TABLE admin_user_change_history
  ADD CONSTRAINT chk_admin_change_action CHECK (
    action::text = ANY (ARRAY[
      'USER_PROFILE_UPDATED', 'USER_BLOCKED', 'USER_UNBLOCKED',
      'USER_LOGIN_UNLOCKED', 'USER_SESSIONS_REVOKED', 'USER_QR_REGENERATED',
      'MERCHANT_BLOCKED', 'MERCHANT_UNBLOCKED',
      'MERCHANT_FEE_CONFIG_UPDATED', 'SYSTEM_FEE_CONFIG_UPDATED',
      'ADMIN_OP_P2P', 'ADMIN_OP_TOPUP', 'ADMIN_OP_WITHDRAW',
      'DISPUTE_OPENED', 'DISPUTE_UPDATED', 'DISPUTE_RESOLVED'
    ]::text[])
  );

COMMIT;
