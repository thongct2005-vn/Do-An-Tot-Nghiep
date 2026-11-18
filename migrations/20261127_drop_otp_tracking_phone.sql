-- Migration: Bỏ cột phone khỏi bảng otp_tracking (hệ thống chỉ dùng OTP qua Email).
-- Chuyển định danh duy nhất sang cột email (UNIQUE NOT NULL) và xóa các bản ghi OTP cũ thiếu email.

BEGIN;

DELETE FROM otp_tracking
 WHERE email IS NULL OR BTRIM(email) = '';

-- Giữ lại bản ghi mới nhất nếu môi trường từng tồn tại email trùng
DELETE FROM otp_tracking a
USING otp_tracking b
WHERE a.id <> b.id
  AND a.email = b.email
  AND (
    a.created_at < b.created_at
    OR (a.created_at = b.created_at AND a.id::text < b.id::text)
  );

ALTER TABLE otp_tracking
  DROP CONSTRAINT IF EXISTS otp_tracking_phone_key;

ALTER TABLE otp_tracking
  DROP COLUMN IF EXISTS phone;

ALTER TABLE otp_tracking
  ALTER COLUMN email SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'otp_tracking'::regclass
      AND conname = 'otp_tracking_email_key'
  ) THEN
    ALTER TABLE otp_tracking
      ADD CONSTRAINT otp_tracking_email_key UNIQUE (email);
  END IF;
END $$;

COMMIT;

