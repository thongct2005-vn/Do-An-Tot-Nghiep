# Triển khai và rollback phí hóa đơn Merchant

Các bước dưới đây dành cho bản Backend đã chạy bộ kiểm thử phí. Không chạy toàn bộ thư mục migrations theo tên: migration phí cũ chứa UPDATE cấu hình và tham chiếu bảng đã bỏ.

1. Đối chiếu catalog như `openspec/changes/ke-hoach-thu-phi-san/verification.md`. Sao lưu bản ghi `system_configs` có key `MERCHANT_FEE_CONFIG` (value, description, updated_by, updated_at) bằng công cụ quản trị DB vào kho backup vận hành. Không ghi credentials/token vào biên bản.
2. Áp `migrations/20261119_payment_request_merchant_fee_snapshot.sql`. Hai cột nullable không cập nhật lịch sử. Có thể VALIDATE CONSTRAINT `payment_requests_merchant_fee_snapshot_check` riêng sau đó, ngoài cửa sổ ADD COLUMN.
3. Tạm dừng nhận yêu cầu tạo/thanh toán QR và TRANSFER vào Merchant khi thay phiên bản Backend. Đưa toàn bộ tiến trình lên code mới cùng lúc; không trộn worker cũ tính phí tháng với worker mới dùng snapshot. Health check và chạy thử trên môi trường test trước mở lại.
4. Áp `migrations/20261120_merchant_invoice_fee_config.sql` sau code mới sẵn sàng. Migration chỉ thay trường phí chiều nhận, giữ phí chuyển chiều gửi, rút tiền và các key khác. Đọc lại biểu phí/preview, đối chiếu bảng chuẩn tại `merchant-fees.md`.
5. QR Merchant cũ PENDING thiếu snapshot bị trả 409, hướng dẫn tạo QR mới/order_id mới; không tự tính lại. Thông báo bên tích hợp về việc tạo lại QR. QR mới chụp phí trong transaction tạo request; QR có snapshot tiếp tục thu đúng phí đó khi Admin đổi cấu hình.
6. Mở lại luồng, kiểm tra số dư người trả giảm gốc (+phí gửi nếu có), Merchant tăng gốc-phí Merchant, ví hệ thống tăng phí; mỗi khoản thu có một ledger row. Giao dịch SUCCESS lịch sử không bị UPDATE bởi hai migration.

## Rollback

- Trước khi rollback code: dừng tạo mới và xử lý QR/TRANSFER Merchant, chờ giao dịch đang chạy hoàn tất. Thống kê PENDING có snapshot. Cho thanh toán bằng code mới tới khi hết PENDING, hoặc hủy có thông báo theo nghiệp vụ hiện có. Không cho code cũ xử lý QR mang snapshot mới.
- Khôi phục chính xác `MERCHANT_FEE_CONFIG.value` từ backup đã lấy ở bước 1 trong một transaction; không lấy giá trị mặc định trong migration cũ để thay thế backup. Triển khai đồng bộ code cũ sau khi không còn request cần snapshot. Khởi động lại các tiến trình để xóa cache cấu hình cũ trước mở lại luồng.
- Giữ hai cột snapshot và tất cả bản ghi SUCCESS/ledger; dữ liệu này là bằng chứng phí. Migration `migrations/rollback/20261119_payment_request_merchant_fee_snapshot.sql` chỉ cho phép bỏ cột khi chưa hề có snapshot. Script từ chối khi đã tồn tại snapshot kể cả request SUCCESS.
- Khi chỉ đổi cấu hình bằng Admin, không rollback snapshot: QR đã tạo vẫn giữ mức phí đã chốt.

## Kiểm chứng tái hiện trên DB thử nghiệm

Trong backend, đặt NODE_ENV=test và chạy:

```text
node --test tests/merchant_fee_reference.test.js tests/merchant_invoice_fee.test.js tests/merchant_fee_snapshot_migration.test.js tests/merchant_fee_config_migration.test.js tests/merchant_fee_flow.test.js
```

Helper tạo DB merchant_test_* mới và tự dọn. Test migration xác nhận áp lặp, rollback chưa dùng, từ chối xóa snapshot đã dùng và bảo toàn dữ liệu lịch sử; test config phục hồi bản chụp cấu hình cũ, không ghi đè phần phí khác; test flow thực hiện Admin đổi phí, tạo QR mới, trả QR cũ, từ chối QR legacy và lỗi giả lập tại từng bước hạch toán.
