-- Migration: Cấu hình nhắc nợ Ví trả sau trong system_configs & lưu tháng đã nhắc trên postpaid_wallets
-- Additive & idempotent: không khóa bảng transactions, an toàn chạy lại.

BEGIN;

ALTER TABLE postpaid_wallets
  ADD COLUMN IF NOT EXISTS last_reminder_month varchar(7);

CREATE INDEX IF NOT EXISTS idx_postpaid_wallets_debt_reminder
  ON postpaid_wallets (last_reminder_month, user_id)
  WHERE used_amount > 0 AND status IN ('ACTIVE', 'PAST_DUE', 'FROZEN');

INSERT INTO system_configs (key, value, description, updated_at)
VALUES (
  'POSTPAID_REMINDER_CONFIG',
  '{
    "enabled": true,
    "reminder_day": 1,
    "reminder_hour": 8,
    "templates": {
      "PAST_DUE": {
        "title": "Ví trả sau đang quá hạn thanh toán",
        "body": "Ví trả sau của bạn còn dư nợ {{used_amount}} ({{overdue_detail}}). Vui lòng thanh toán để mở lại chi tiêu."
      },
      "BILLED": {
        "title": "Nhắc thanh toán dư nợ Ví trả sau",
        "body": "Bạn còn dư nợ {{statement_debt}}{{cycle_part}} cần thanh toán{{due_part}}{{unbilled_part}}."
      },
      "UNBILLED": {
        "title": "Thông báo dư nợ Ví trả sau",
        "body": "Ví trả sau của bạn hiện còn dư nợ {{used_amount}} chưa thanh toán. Bạn có thể thanh toán bất kỳ lúc nào trên ứng dụng."
      }
    }
  }'::jsonb,
  'Cấu hình lịch và mẫu nội dung thông báo nhắc nợ Ví trả sau hàng tháng (ngày 1 lúc >= 08:00 giờ VN)',
  NOW()
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
