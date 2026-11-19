-- Rollback for 20261128_drop_uk_users_phone_constraint.sql (run AFTER CREATE UNIQUE INDEX CONCURRENTLY uk_users_phone).
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE public.users ADD CONSTRAINT uk_users_phone UNIQUE USING INDEX uk_users_phone;
COMMIT;
