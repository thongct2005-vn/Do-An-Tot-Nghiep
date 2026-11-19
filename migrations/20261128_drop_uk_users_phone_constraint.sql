-- Xóa UNIQUE CONSTRAINT trùng trên public.users (uk_users_phone trùng 100% với users_phone_key).
-- Thực thi tách riêng ngoài giờ cao điểm với lock_timeout = '2s' (bảng users 4 MB, < 5ms metadata lock).

BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS uk_users_phone;
COMMIT;
