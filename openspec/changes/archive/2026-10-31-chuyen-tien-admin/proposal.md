# Proposal: Nghiệp vụ Admin chuyển tiền P2P mô phỏng có kiểm soát (chuyen-tien-admin)

## Why

Hệ thống Quản trị Ví điện tử (Web Admin) hiện đã có khả năng tra cứu thông tin người dùng, xem lịch sử giao dịch và khóa/mở khóa tài khoản, nhưng chưa có API nghiệp vụ cho phép Quản trị viên thực hiện chuyển tiền P2P hỗ trợ người dùng (`USER A` sang `USER B`) khi có yêu cầu hỗ trợ hoặc xử lý sự cố vận hành trong phạm vi mô phỏng của đồ án. Việc bổ sung chức năng này cần tái sử dụng lõi giao dịch P2P hiện có (`TransactionRepository.executeTransfer`), đồng thời thiết lập đầy đủ các chốt chặn kiểm soát nội bộ (xác thực lại mật khẩu Admin, mã tham chiếu ủy quyền `authorization_reference`, chống giao dịch trùng lặp nguyên tử với `Idempotency-Key`, kiểm tra trạng thái/hạn mức sau khi khóa dòng `FOR UPDATE`, và ghi vết kiểm toán hai chiều vào `admin_user_change_history`).

## What Changes

- **Bổ sung API Admin chuyển tiền P2P (`POST /api/v2/admin/user/:id/operations/p2p`)**:
  - Cho phép Quản trị viên (`role = 'ADMIN'`) thực hiện chuyển tiền mô phỏng từ ví nguồn `USER A` (`:id`) sang ví đích `USER B` (`destination_user_id`).
  - Bắt buộc **Xác thực lại Admin (Step-up Re-authentication)** qua trường `admin_password` (đối chiếu `bcrypt` với `password_hash` của Admin đang đăng nhập và áp dụng cơ chế đếm lỗi/khóa tạm nếu nhập sai).
  - Bắt buộc cung cấp **Lý do thực hiện (`reason`)** và **Bằng chứng ủy quyền / Mã phiếu hỗ trợ (`authorization_reference`)** hợp lệ.
- **Nâng cấp cơ chế chống giao dịch trùng (`Idempotency-Key`) và đồng bộ trong PostgreSQL Transaction**:
  - Tận dụng cột `idempotency_keys.request_path` (đã nâng cấp lên `VARCHAR(255)`) để lưu đầy đủ đường dẫn chuẩn hóa mà không bị cắt chuỗi.
  - Tính toán dấu vân tay `request_hash` (SHA-256) gắn chặt với tổ hợp dữ liệu giao dịch (`admin_id`, `source_user_id`, `destination_user_id`, `amount`, `description`, `reason`, `authorization_reference`). Từ chối ngay (`422 Unprocessable Entity`) nếu dùng lại `Idempotency-Key` với thông số khác, hoặc (`409 Conflict`) nếu có request đồng thời đang xử lý.
  - Cập nhật trạng thái `idempotency_keys.status = 'SUCCESS'` và `response_body` ngay bên trong cùng Database Transaction trước khi `COMMIT`.
- **Hoàn thiện kiểm tra trạng thái, hạn mức và bất biến bảo toàn tiền ngay sau khi giữ khóa `SELECT ... FOR UPDATE`**:
  - Kiểm tra lại `role = 'USER'` và `status = 'ACTIVE'` của cả `USER A` và `USER B` sau khi đã khóa dòng theo thứ tự ID để triệt tiêu race condition khi một Admin khác khóa tài khoản đồng thời.
  - Kiểm tra hạn mức mỗi giao dịch (`1.000đ` – `50.000.000đ`), tổng hạn mức giao dịch trong ngày của ví nguồn (`<= 50.000.000đ/ngày`), số dư khả dụng, và bất biến bảo toàn tổng số dư hai ví trước/sau giao dịch (`source_before + dest_before == source_after + dest_after + fee`).
- **Ghi nhận Audit Log tinh gọn và hỗ trợ tra cứu hai chiều trên `admin_user_change_history`**:
  - Ghi bản ghi kiểm toán với `action = 'ADMIN_OP_P2P'` trong cùng transaction với `executeTransfer`, lưu `balance_before` và `new_values` chuẩn hóa (`balance_after`, `transaction_id`, `transaction_type`, `amount`, `fee`, `destination_user_id`, `authorization_reference`, `execution_mode: "SIMULATED_ADMIN_P2P"`), không lưu dư thừa số điện thoại đầy đủ trong JSONB.
  - Cập nhật truy vấn lịch sử `GET /api/v2/admin/user/:id/history` để tra cứu được bản ghi `ADMIN_OP_P2P` từ cả phía ví gửi (`USER A`) lẫn phía ví nhận (`USER B`).
- **Tinh gọn Response API và cô lập lỗi thông báo sau `COMMIT`**:
  - Không trả số dư của `USER B` (`destBalanceAfter`), che số điện thoại người nhận (`destination_phone_masked`), và chỉ phát Socket `wallet_balance_updated` + Push Notification FCM sau khi đã `COMMIT` thành công trong khối `try/catch` độc lập.

## Capabilities

### New Capabilities
<!-- Không tạo capability mới vì toàn bộ nghiệp vụ thuộc miền quản trị người dùng admin-user -->

### Modified Capabilities
- `admin-user`: Bổ sung yêu cầu thực thi nghiệp vụ Admin chuyển tiền P2P có kiểm soát (`POST /api/v2/admin/user/:id/operations/p2p`), nâng cấp kiểm soát Idempotency nguyên tử, và mở rộng yêu cầu ghi nhận/truy vấn lịch sử kiểm toán (`admin_user_change_history`) hỗ trợ hành động `ADMIN_OP_P2P` hai chiều (cả ví nguồn và ví đích).

## Impact

- **Database Schema ([ewallet_db.sql](file:///d:/KH23_CNTT_HK6_DATN_CODE/ewallet_db.sql))**: Mở rộng cột `public.idempotency_keys.request_path` lên `VARCHAR(255)` và bổ sung index hỗ trợ tra cứu `destination_user_id` trong `admin_user_change_history`.
- **Backend Modules**:
  - `backend/src/admin/user/user.routes.js`: Thêm endpoint `POST /:id/operations/p2p`.
  - `backend/src/admin/user/user.controller.js`: Xử lý request, điều phối thông báo Socket/FCM sau `COMMIT`.
  - `backend/src/admin/user/user.service.js`: Xác thực lại mật khẩu Admin, kiểm tra tham số đầu vào, điều phối Idempotency và dịch vụ chuyển tiền P2P.
  - `backend/src/admin/user/user.repository.js`: Thực thi transaction nguyên tử kết hợp `TransactionRepository.executeTransfer`, kiểm tra trạng thái/hạn mức sau `FOR UPDATE`, ghi `admin_user_change_history`, cập nhật `idempotency_keys`, và mở rộng `getUserChangeHistory` tra cứu 2 chiều.
  - `backend/src/modules/transaction/transaction.repository.js`: Đảm bảo `executeTransfer` kiểm tra chặt trạng thái `ACTIVE`, `role = 'USER'` và bất biến số dư ngay sau khi `SELECT ... FOR UPDATE`.
- **Testing**: Thêm bộ kiểm thử đơn vị và tích hợp (`backend/tests/admin_user_p2p.test.js`) bao phủ đầy đủ 14 kịch bản bắt buộc (giao dịch hợp lệ, thiếu số dư, tài khoản bị khóa trước/trong khi giữ khóa, sai mật khẩu Admin, thiếu mã ủy quyền, xung đột Idempotency, cạnh tranh đồng thời, rollback khi lỗi audit, cô lập lỗi Socket/FCM).

