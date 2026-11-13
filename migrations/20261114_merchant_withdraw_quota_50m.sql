-- Migration: Cấu hình hạn mức rút tiền miễn phí mặc định cho Merchant là 50.000.000đ/tháng, phần vượt tính phí 0.5% (50 bps)

BEGIN;

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
    "withdraw_fee_bps": 50,
    "withdraw_free_quota_per_month": 50000000,
    "monthly_plan_enabled": false,
    "monthly_plan_fee": 0,
    "monthly_grace_days": 7,
    "tiers": [
      { "from_amount": 0, "rate_bps": 100 },
      { "from_amount": 50000000, "rate_bps": 80 },
      { "from_amount": 200000000, "rate_bps": 60 }
    ]
  }'::jsonb,
  'Cấu hình biểu phí bậc thang mặc định cho Merchant (0-50tr: 1%, 50-200tr: 0.8%, >=200tr: 0.6%, min 200đ, max_fee=null, rút tiền miễn phí 50tr/tháng rồi thu 0.5%, transfer P2P mặc định 0đ, bỏ gói tháng)',
  NOW()
)
ON CONFLICT (key) DO UPDATE SET
  value = COALESCE(system_configs.value, '{}'::jsonb) || '{"withdraw_fee_bps": 50, "withdraw_free_quota_per_month": 50000000}'::jsonb,
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;

