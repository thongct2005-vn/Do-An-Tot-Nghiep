-- Xóa 3 khóa thừa của gói thu phí tháng khỏi cấu hình MERCHANT_FEE_CONFIG trong system_configs
UPDATE system_configs
   SET value = value - 'monthly_plan_enabled' - 'monthly_plan_fee' - 'monthly_grace_days',
       updated_at = NOW()
 WHERE key = 'MERCHANT_FEE_CONFIG'
   AND (
     value ? 'monthly_plan_enabled'
     OR value ? 'monthly_plan_fee'
     OR value ? 'monthly_grace_days'
   );

