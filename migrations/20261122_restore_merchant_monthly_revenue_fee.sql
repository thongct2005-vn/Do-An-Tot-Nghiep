-- Khôi phục biểu phí nhận tiền Merchant về mô hình bậc thang lũy tiến theo doanh số QR hàng tháng
-- Bậc: 0đ -> 1.0% (100 bps), từ 50.000.000đ -> 0.8% (80 bps), từ 200.000.000đ -> 0.6% (60 bps), min_fee 200đ.

BEGIN;

UPDATE system_configs
   SET value = value || '{
         "rate_bps": 100,
         "min_fee": 200,
         "max_fee": null,
         "free_threshold_amount": 0,
         "tiers": [
           {"from_amount": 0, "rate_bps": 100},
           {"from_amount": 50000000, "rate_bps": 80},
           {"from_amount": 200000000, "rate_bps": 60}
         ]
       }'::jsonb,
       updated_at = NOW()
 WHERE key = 'MERCHANT_FEE_CONFIG';

COMMIT;

