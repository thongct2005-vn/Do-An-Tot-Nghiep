-- Migration: Postpaid Wallet (Ví trả sau MVP)
-- Additive only: adds postpaid_wallets & postpaid_entries without modifying or locking transactions (9.6M+ rows).

BEGIN;

-- 1. Ví nguồn vốn hệ thống cho Ví trả sau (bảo toàn tổng tiền toàn hệ thống)
--    users.phone là varchar(10) nên dùng mã định danh 10 ký tự 'SYS_BNPL_1'
INSERT INTO users (
  id, role, full_name, email, phone, status, balance, created_at, updated_at
)
VALUES (
  '00000000-0000-7000-8000-000000000002'::uuid,
  'SYSTEM',
  'SYSTEM_POSTPAID_WALLET',
  'system_postpaid_wallet@system.internal',
  'SYS_BNPL_1',
  'ACTIVE',
  100000000000,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- 2. Cấu hình Ví trả sau mặc định trong system_configs
INSERT INTO system_configs (key, value, description, updated_at)
VALUES
  (
    'POSTPAID_CONFIG',
    '{
      "enabled": true,
      "default_credit_limit": 2000000,
      "min_account_days": 1,
      "billing_day": 20,
      "due_day": 5,
      "late_fee_bps": 200,
      "min_late_fee": 10000
    }'::jsonb,
    'Cấu hình Ví trả sau (hạn mức mặc định 2.000.000đ, tài khoản tạo tối thiểu 1 ngày/24h, chốt kỳ ngày 20, hạn trả ngày 5 tháng sau, phí trễ hạn 2% min 10.000đ)',
    NOW()
  ),
  (
    'POSTPAID_STATUS',
    '{
      "INACTIVE": "Chưa kích hoạt",
      "ACTIVE": "Đang hoạt động",
      "PAST_DUE": "Quá hạn thanh toán",
      "FROZEN": "Đang tạm khóa"
    }'::jsonb,
    'Danh mục trạng thái Ví trả sau và nhãn hiển thị tiếng Việt',
    NOW()
  ),
  (
    'POSTPAID_ENTRY_ACTIONS',
    '{
      "PURCHASE": "Thanh toán QR bằng Ví trả sau",
      "REPAY_PRINCIPAL": "Trả nợ gốc Ví trả sau",
      "REPAY_LATE_FEE": "Thanh toán phí trễ hạn",
      "LATE_FEE": "Phí trễ hạn kỳ sao kê",
      "REFUND": "Hoàn tiền giao dịch Ví trả sau",
      "STATEMENT_CLOSE": "Chốt sao kê kỳ",
      "LIMIT_ADJUST": "Điều chỉnh hạn mức"
    }'::jsonb,
    'Danh mục loại biến động Ví trả sau và nhãn hiển thị tiếng Việt',
    NOW()
  )
ON CONFLICT (key) DO NOTHING;

-- 3. Bảng trạng thái Ví trả sau (1 dòng / user đã kích hoạt)
CREATE TABLE IF NOT EXISTS postpaid_wallets (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('INACTIVE', 'ACTIVE', 'PAST_DUE', 'FROZEN')),
  credit_limit bigint NOT NULL CHECK (credit_limit >= 0),
  used_amount bigint NOT NULL DEFAULT 0 CHECK (used_amount >= 0),
  billed_amount bigint NOT NULL DEFAULT 0 CHECK (billed_amount >= 0),
  late_fee_amount bigint NOT NULL DEFAULT 0 CHECK (late_fee_amount >= 0),
  current_cycle_month varchar(7),
  due_date date,
  activated_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_postpaid_debt_bounds
    CHECK (billed_amount + late_fee_amount <= used_amount)
);

-- 4. Hàm sinh UUID v7 thuần PostgreSQL & Sổ cái append-only mọi biến động hạn mức Ví trả sau (SUM(delta_used) == used_amount)
CREATE OR REPLACE FUNCTION public.uuid_generate_v7()
RETURNS uuid
AS $$
  SELECT encode(
    set_byte(b, 6, (get_byte(b, 6) & 15) | 112),
    'hex'
  )::uuid
  FROM (
    SELECT overlay(
      decode(replace(gen_random_uuid()::text, '-', ''), 'hex')
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3 FOR 6)
      FROM 1 FOR 6
    ) AS b
  ) t;
$$
LANGUAGE sql
VOLATILE;

CREATE TABLE IF NOT EXISTS postpaid_entries (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tx_id varchar REFERENCES transactions(id) ON DELETE RESTRICT,
  ref_tx_id varchar REFERENCES transactions(id) ON DELETE RESTRICT,
  action varchar(30) NOT NULL CHECK (action IN (
    'PURCHASE', 'REPAY_PRINCIPAL', 'REPAY_LATE_FEE',
    'LATE_FEE', 'REFUND', 'STATEMENT_CLOSE', 'LIMIT_ADJUST'
  )),
  amount bigint NOT NULL CHECK (amount >= 0),
  delta_used bigint NOT NULL,
  used_before bigint NOT NULL CHECK (used_before >= 0),
  used_after bigint NOT NULL CHECK (used_after >= 0),
  cycle_month varchar(7),
  note text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE postpaid_entries
  ALTER COLUMN id SET DEFAULT public.uuid_generate_v7();

UPDATE postpaid_entries
   SET id = encode(
     set_byte(
       overlay(
         decode(replace(id::text, '-', ''), 'hex')
         placing substring(int8send(floor(extract(epoch FROM created_at) * 1000)::bigint) FROM 3 FOR 6)
         FROM 1 FOR 6
       ),
       6,
       (get_byte(decode(replace(id::text, '-', ''), 'hex'), 6) & 15) | 112
     ),
     'hex'
   )::uuid
 WHERE substring(id::text, 15, 1) = '4';

CREATE INDEX IF NOT EXISTS idx_postpaid_entries_user_time
  ON postpaid_entries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_postpaid_entries_tx
  ON postpaid_entries (tx_id)
  WHERE tx_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_postpaid_entries_ref_tx
  ON postpaid_entries (ref_tx_id)
  WHERE ref_tx_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_postpaid_statement_cycle
  ON postpaid_entries (user_id, cycle_month)
  WHERE action = 'STATEMENT_CLOSE';

CREATE UNIQUE INDEX IF NOT EXISTS uk_postpaid_late_fee_cycle
  ON postpaid_entries (user_id, cycle_month)
  WHERE action = 'LATE_FEE';

-- 5. Mở rộng CHECK fee_type trên fee_ledger_entries để hạch toán phí phạt trả sau về SYSTEM_FEE_WALLET
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  FOR v_constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'fee_ledger_entries'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%fee_type%'
  LOOP
    EXECUTE format('ALTER TABLE fee_ledger_entries DROP CONSTRAINT %I', v_constraint_name);
  END LOOP;
END $$;

ALTER TABLE fee_ledger_entries
  ADD CONSTRAINT chk_fee_ledger_fee_type
  CHECK (fee_type IN (
    'QR_FEE', 'USER_FEE', 'WITHDRAW_FEE', 'MONTHLY_PLAN_FEE', 'POSTPAID_LATE_FEE'
  ));

COMMIT;
