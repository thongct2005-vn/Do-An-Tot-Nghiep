-- Migration: Gộp bảng transaction_limit_policies vào system_configs['TRANSACTION_LIMIT_CONFIG'] và xóa bảng cũ
-- Idempotent: bảo toàn dữ liệu hiện có trong transaction_limit_policies nếu bảng còn tồn tại trước khi DROP TABLE.

BEGIN;

DO $$
DECLARE
  v_payload jsonb;
BEGIN
  IF to_regclass('public.transaction_limit_policies') IS NOT NULL THEN
    SELECT jsonb_object_agg(role_name, role_policies)
      INTO v_payload
      FROM (
        SELECT role AS role_name,
               jsonb_object_agg(
                 transaction_type,
                 jsonb_build_object(
                   'min_amount', min_amount,
                   'max_amount', max_amount,
                   'daily_limit', daily_limit
                 )
                 ORDER BY transaction_type
               ) AS role_policies
          FROM transaction_limit_policies
         GROUP BY role
      ) grouped;

    IF v_payload IS NOT NULL THEN
      INSERT INTO system_configs (key, value, description, updated_at)
      VALUES (
        'TRANSACTION_LIMIT_CONFIG',
        v_payload,
        'Chính sách hạn mức giao dịch hệ thống theo vai trò (USER / MERCHANT) và loại giao dịch (min_amount, max_amount, daily_limit)',
        NOW()
      )
      ON CONFLICT (key) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO system_configs (key, value, description, updated_at)
  VALUES (
    'TRANSACTION_LIMIT_CONFIG',
    '{
      "MERCHANT": {
        "QR_PAYMENT": {"min_amount": 1000, "max_amount": 50000000, "daily_limit": null},
        "SANDBOX_TOPUP": {"min_amount": 1000, "max_amount": 50000000, "daily_limit": null},
        "TOPUP": {"min_amount": 10000, "max_amount": 50000000, "daily_limit": 50000000},
        "TRANSFER": {"min_amount": 1000, "max_amount": 50000000, "daily_limit": 50000000},
        "WITHDRAW": {"min_amount": 10000, "max_amount": 200000000, "daily_limit": 500000000}
      },
      "USER": {
        "QR_PAYMENT": {"min_amount": 1000, "max_amount": 50000000, "daily_limit": null},
        "SANDBOX_TOPUP": {"min_amount": 1000, "max_amount": 50000000, "daily_limit": null},
        "TOPUP": {"min_amount": 10000, "max_amount": 50000000, "daily_limit": 50000000},
        "TRANSFER": {"min_amount": 1000, "max_amount": 50000000, "daily_limit": 50000000},
        "WITHDRAW": {"min_amount": 10000, "max_amount": 30000000, "daily_limit": 30000000}
      }
    }'::jsonb,
    'Chính sách hạn mức giao dịch hệ thống theo vai trò (USER / MERCHANT) và loại giao dịch (min_amount, max_amount, daily_limit)',
    NOW()
  )
  ON CONFLICT (key) DO NOTHING;
END $$;

DROP TABLE IF EXISTS transaction_limit_policies;

COMMIT;

