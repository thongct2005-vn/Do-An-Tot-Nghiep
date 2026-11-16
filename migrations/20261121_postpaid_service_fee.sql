-- Migration: Phí quản lý dịch vụ Ví trả sau theo tháng (mặc định 20.000đ/tháng, miễn phí 1 giao dịch đầu tiên)
-- Additive & idempotent: không khóa bảng transactions, an toàn chạy lại.

BEGIN;

-- 1. Thêm cột service_fee_amount trên postpaid_wallets & cập nhật chk_postpaid_debt_bounds
ALTER TABLE postpaid_wallets
  ADD COLUMN IF NOT EXISTS service_fee_amount bigint NOT NULL DEFAULT 0;

ALTER TABLE postpaid_wallets
  DROP CONSTRAINT IF EXISTS postpaid_wallets_service_fee_amount_check;
ALTER TABLE postpaid_wallets
  ADD CONSTRAINT postpaid_wallets_service_fee_amount_check
    CHECK (service_fee_amount >= 0);

ALTER TABLE postpaid_wallets
  DROP CONSTRAINT IF EXISTS chk_postpaid_debt_bounds;
ALTER TABLE postpaid_wallets
  ADD CONSTRAINT chk_postpaid_debt_bounds
    CHECK (billed_amount + service_fee_amount + late_fee_amount <= used_amount);

-- 2. Mở rộng postpaid_entries.action cho SERVICE_FEE & REPAY_SERVICE_FEE + khóa chống thu trùng 1 kỳ
ALTER TABLE postpaid_entries
  DROP CONSTRAINT IF EXISTS postpaid_entries_action_check;
ALTER TABLE postpaid_entries
  ADD CONSTRAINT postpaid_entries_action_check
    CHECK (action IN (
      'PURCHASE', 'REPAY_PRINCIPAL', 'REPAY_SERVICE_FEE', 'REPAY_LATE_FEE',
      'SERVICE_FEE', 'LATE_FEE', 'REFUND', 'STATEMENT_CLOSE', 'LIMIT_ADJUST'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS uk_postpaid_service_fee_cycle
  ON postpaid_entries (user_id, cycle_month)
  WHERE action = 'SERVICE_FEE';

-- 3. Mở rộng fee_ledger_entries.fee_type cho POSTPAID_SERVICE_FEE
ALTER TABLE fee_ledger_entries
  DROP CONSTRAINT IF EXISTS chk_fee_ledger_fee_type;
ALTER TABLE fee_ledger_entries
  ADD CONSTRAINT chk_fee_ledger_fee_type
    CHECK (fee_type IN (
      'QR_FEE', 'USER_FEE', 'WITHDRAW_FEE', 'MONTHLY_PLAN_FEE',
      'POSTPAID_LATE_FEE', 'POSTPAID_SERVICE_FEE'
    ));

-- 4. Cập nhật cấu hình & danh mục hiển thị trong system_configs
UPDATE system_configs
   SET value = jsonb_set(
         jsonb_set(
           value,
           '{monthly_service_fee}',
           COALESCE(value->'monthly_service_fee', '20000'::jsonb),
           true
         ),
         '{free_service_fee_tx_count}',
         COALESCE(value->'free_service_fee_tx_count', '1'::jsonb),
         true
       ),
       description = 'Cấu hình Ví trả sau (hạn mức mặc định 2.000.000đ, tài khoản tối thiểu 24h, chốt kỳ ngày 20, hạn trả ngày 5 tháng sau, phí trễ hạn 2% min 10.000đ, phí dịch vụ tháng 20.000đ miễn 1 GD đầu)',
       updated_at = NOW()
 WHERE key = 'POSTPAID_CONFIG';

UPDATE system_configs
   SET value = value || '{
         "SERVICE_FEE": "Phí dịch vụ Ví trả sau hàng tháng",
         "REPAY_SERVICE_FEE": "Thanh toán phí dịch vụ Ví trả sau"
       }'::jsonb,
       updated_at = NOW()
 WHERE key = 'POSTPAID_ENTRY_ACTIONS';

COMMIT;

