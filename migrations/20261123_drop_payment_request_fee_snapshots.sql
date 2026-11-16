-- Gỡ bỏ 2 cột snapshot phí khỏi payment_requests khi sử dụng mô hình tính phí theo doanh thu tháng.
-- Snapshot phí giao dịch hoàn chỉnh đã được lưu tại transactions.fee_rate_snapshot lúc thanh toán.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_merchant_fee_snapshot_check,
  DROP COLUMN IF EXISTS merchant_fee_amount_snapshot,
  DROP COLUMN IF EXISTS merchant_fee_rule_snapshot;

COMMIT;

