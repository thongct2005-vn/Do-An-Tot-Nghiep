# Tasks: Nghiệp vụ Admin chuyển tiền P2P mô phỏng có kiểm soát (chuyen-tien-admin)

## 1. Cập nhật Schema Cơ sở dữ liệu & Nâng cấp Lõi Chuyển tiền (`TransactionRepository`)

- [x] 1.1 Tạo chỉ mục `idx_admin_history_p2p_dest_user` trên bảng `public.admin_user_change_history` trên CSDL để tối ưu tra cứu hai chiều cho giao dịch P2P; đồng bộ định nghĩa chỉ mục và cột `request_path VARCHAR(255)` vào `ewallet_db.sql`
- [x] 1.2 Nâng cấp `TransactionRepository.executeTransfer` trong `backend/src/modules/transaction/transaction.repository.js` để truy vấn thêm `role, status` trong câu lệnh `SELECT ... FOR UPDATE`, kiểm tra cả hai tài khoản có `role = 'USER'` và `status = 'ACTIVE'`, kiểm tra tổng hạn mức giao dịch trong ngày (`<= 50.000.000đ`), kiểm tra bất biến bảo toàn tổng số dư hai ví (`source_before + dest_before == source_after + dest_after + fee`) và trả về `sourceBalanceBefore` cùng kết quả giao dịch; viết unit test kiểm tra các nhánh lỗi sau `FOR UPDATE`

## 2. Triển khai Repository Nghiệp vụ Admin P2P, Idempotency Nguyên tử & Tra cứu Lịch sử Hai chiều

- [x] 2.1 Bổ sung các hàm quản lý `idempotency_keys` và thực thi giao dịch nguyên tử `executeAdminP2PWithHistory` trong `backend/src/admin/user/user.repository.js` (mở `client`, khóa `idempotency_keys FOR UPDATE`, gọi `TransactionRepository.executeTransfer(client, ...)`, chèn bản ghi `admin_user_change_history` với `action = 'ADMIN_OP_P2P'` và JSONB tinh gọn, cập nhật `idempotency_keys` sang `SUCCESS` kèm `response_body` trước khi `COMMIT`, hoặc `ROLLBACK` toàn bộ nếu bất kỳ bước nào lỗi); xác minh qua unit test với mock `client`
- [x] 2.2 Cập nhật `adminUserRepository.getUserChangeHistory` và `adminUserService.getUserChangeHistory` trong `backend/src/admin/user/` để hỗ trợ tra cứu hai chiều cho `ADMIN_OP_P2P` (khớp `h.user_id = $1` hoặc `h.new_values->>'destination_user_id' = $1::text`) kèm trường `role_in_operation` (`SOURCE` / `DESTINATION`); viết test xác nhận tra cứu từ cả phía ví gửi (`USER A`) và ví nhận (`USER B`)

## 3. Triển khai Service, Controller & Route cho API `POST /api/v2/admin/user/:id/operations/p2p`

- [x] 3.1 Bổ sung hàm xác thực lại mật khẩu Admin (`verifyAdminStepUpPassword`) và hàm `executeAdminP2P` trong `backend/src/admin/user/user.service.js`: kiểm tra `Idempotency-Key`, `reason`, định dạng `authorization_reference` (`/^[A-Za-z0-9_-]{5,100}$/`), hạn mức `1.000đ–50.000.000đ`, `sourceUserId !== destinationUserId`, xác thực `admin_password` bằng `bcrypt` (tăng `failed_login_attempts` nếu sai), tính `request_hash` chuẩn hóa (SHA-256), xử lý xung đột/cạnh tranh Idempotency (`422` / `409` / trả kết quả đã lưu), và định dạng response tinh gọn với `maskPhone`
- [x] 3.2 Bổ sung controller `executeAdminP2P` trong `backend/src/admin/user/user.controller.js` và khai báo route `POST /:id/operations/p2p` trong `backend/src/admin/user/user.routes.js`; đảm bảo việc phát Socket (`wallet_balance_updated`) và Push Notification (`sendPushNotification`) cho `USER A` và `USER B` chỉ chạy sau khi `COMMIT` thành công và được bọc trong khối `try/catch` cô lập lỗi

## 4. Kiểm thử Tự động Toàn diện (14 Test Cases Bắt buộc)

- [x] 4.1 Tạo file kiểm thử `backend/tests/admin_user_p2p.test.js` kiểm tra đầy đủ 14 kịch bản bắt buộc: (1) chuyển tiền hợp lệ + bảo toàn tổng số dư hai ví, (2) ví nguồn không đủ số dư, (3) `USER A` bị `BLOCKED`, (4) `USER B` bị `BLOCKED`, (5) `USER A` trùng `USER B`, (6) tài khoản `USER` thường gọi API Admin bị chặn `403`, (7) thiếu `reason`, (8) thiếu `authorization_reference` hoặc sai `admin_password`, (9) gửi lại cùng `Idempotency-Key` trả kết quả cũ không trừ tiền lần 2, (10) cùng `Idempotency-Key` nhưng khác số tiền/người nhận bị từ chối `422`, (11) hai request đồng thời (`Promise.all`) dùng cùng key chỉ trừ tiền 1 lần, (12) lỗi ghi `admin_user_change_history` thực hiện `ROLLBACK` toàn bộ, (13) lỗi Socket/FCM sau `COMMIT` vẫn trả `200 OK`, (14) `USER A` hoặc `USER B` vừa bị khóa ngay trước `FOR UPDATE` bị từ chối an toàn; chạy `node --test backend/tests/admin_user_p2p.test.js` và toàn bộ test suite hiện có để xác nhận tất cả đều PASS

## Workflow follow-up

- Sau khi triển khai và vượt qua toàn bộ 14 test cases bằng `/opsx-apply`, đồng bộ spec hoặc lưu trữ change bằng `/opsx-archive`.

