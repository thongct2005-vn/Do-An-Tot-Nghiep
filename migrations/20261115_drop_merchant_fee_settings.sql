-- Migration: Xóa bảng merchant_fee_settings (gói thu phí tháng đã ngừng áp dụng, toàn bộ merchant dùng PER_TRANSACTION thống nhất)

BEGIN;

DROP TABLE IF EXISTS merchant_fee_settings CASCADE;

COMMIT;

