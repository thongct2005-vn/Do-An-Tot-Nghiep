-- Migration: Biểu phí bậc thang lũy tiến theo doanh số QR tháng, tách phí chuyển P2P merchant, bỏ giới hạn trần max_fee = 50.000, tắt gói tháng 300k/tháng

BEGIN;

-- 1. Mở rộng bảng lịch sử override biểu phí merchant để hỗ trợ tách phí chuyển P2P
ALTER TABLE merchant_fee_schedules
  ADD COLUMN IF NOT EXISTS transfer_fee_bps integer CHECK (transfer_fee_bps IS NULL OR (transfer_fee_bps >= 0 AND transfer_fee_bps <= 10000)),
  ADD COLUMN IF NOT EXISTS transfer_min_fee bigint CHECK (transfer_min_fee IS NULL OR transfer_min_fee >= 0),
  ADD COLUMN IF NOT EXISTS transfer_max_fee bigint CHECK (transfer_max_fee IS NULL OR transfer_max_fee >= 0),
  ADD COLUMN IF NOT EXISTS transfer_max_fee_unbounded boolean NOT NULL DEFAULT false;

ALTER TABLE merchant_fee_schedules
  DROP CONSTRAINT IF EXISTS chk_mfs_schedule_transfer_min_max;
ALTER TABLE merchant_fee_schedules
  ADD CONSTRAINT chk_mfs_schedule_transfer_min_max
  CHECK (transfer_min_fee IS NULL OR transfer_max_fee IS NULL OR transfer_min_fee <= transfer_max_fee);

-- 2. Cập nhật MERCHANT_FEE_CONFIG mặc định toàn hệ thống
INSERT INTO system_configs (key, value, description, updated_at)
VALUES (
  'MERCHANT_FEE_CONFIG',
  '{
    "rate_bps": 100,
    "min_fee": 200,
    "max_fee": null,
    "free_threshold_amount": 0,
    "transfer_fee_bps": 0,
    "transfer_min_fee": 0,
    "transfer_max_fee": null,
    "withdraw_fee_bps": 0,
    "withdraw_free_quota_per_month": 0,
    "monthly_plan_enabled": false,
    "monthly_plan_fee": 0,
    "monthly_grace_days": 7,
    "tiers": [
      { "from_amount": 0, "rate_bps": 100 },
      { "from_amount": 50000000, "rate_bps": 80 },
      { "from_amount": 200000000, "rate_bps": 60 }
    ]
  }'::jsonb,
  'Cấu hình biểu phí bậc thang mặc định cho Merchant (0-50tr: 1%, 50-200tr: 0.8%, >=200tr: 0.6%, min 200đ, max_fee=null, transfer P2P mặc định 0đ, bỏ gói tháng)',
  NOW()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = NOW();

-- 3. Bổ sung trường transfer_fee_* vào USER_FEE_CONFIG nếu chưa có (mặc định 0đ)
UPDATE system_configs
   SET value = jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     COALESCE(value, '{}'::jsonb),
                     '{transfer_fee_bps}',
                     COALESCE(value->'transfer_fee_bps', '0'::jsonb),
                     true
                   ),
                   '{transfer_min_fee}',
                   COALESCE(value->'transfer_min_fee', '0'::jsonb),
                   true
                 ),
                 '{transfer_max_fee}',
                 COALESCE(value->'transfer_max_fee', 'null'::jsonb),
                 true
               ),
       updated_at = NOW()
 WHERE key = 'USER_FEE_CONFIG';

-- 4. Bỏ giới hạn trần max_fee = 50.000 trong các lịch ghi đè cũ (nếu có)
UPDATE merchant_fee_schedules
   SET max_fee = NULL,
       max_fee_unbounded = true
 WHERE max_fee = 50000;

-- 5. Đưa các bản ghi merchant_fee_settings đang bật MONTHLY / pending MONTHLY về PER_TRANSACTION (giữ nguyên overdue_amount nếu còn nợ cũ)
UPDATE merchant_fee_settings
   SET fee_plan = 'PER_TRANSACTION',
       pending_fee_plan = NULL,
       expires_at = NULL,
       monthly_plan_enabled = false,
       monthly_status = 'INACTIVE',
       grace_until = NULL,
       updated_at = NOW()
 WHERE fee_plan = 'MONTHLY'
    OR pending_fee_plan IS NOT NULL
    OR monthly_plan_enabled = true;

COMMIT;

