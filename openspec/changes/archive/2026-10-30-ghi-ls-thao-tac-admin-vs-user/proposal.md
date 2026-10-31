# Proposal: Ghi lịch sử thao tác của Admin đối với tài khoản User

## Why

Hiện tại hệ thống ví điện tử đã có sẵn bảng cơ sở dữ liệu `admin_user_change_history` với đầy đủ các ràng buộc kiểm toán (`admin_id`, `user_id`, `action`, `reason`, `old_values`, `new_values`), tuy nhiên 2 API quản trị người dùng hiện có (`PATCH /admin/user/:id/status` và `PATCH /admin/user/:id/profile`) chưa thực hiện ghi log kiểm toán. Điều này khiến các hành động nhạy cảm của Admin (như khóa tài khoản, đổi số điện thoại, đổi email) không được lưu vết bằng chứng trong cơ sở dữ liệu và Web Admin chưa có API để tra cứu lịch sử can thiệp của từng người dùng. Việc hoàn thiện cơ chế ghi vết và truy vấn lịch sử là yêu cầu bắt buộc để đảm bảo tính minh bạch, an toàn dữ liệu và tuân thủ tiêu chuẩn kiểm toán hệ thống tài chính cho đồ án tốt nghiệp.

## What Changes

- **Nâng cấp ngầm 2 API quản trị User hiện có**:
  - `PATCH /api/v2/admin/user/:id/status`: Đóng gói việc cập nhật trạng thái người dùng và chèn bản ghi vào bảng `admin_user_change_history` (`action = 'UPDATE_STATUS'`) trong cùng một Database Transaction khép kín. Bắt buộc nhập lý do (`reason`). Khi khóa tài khoản (`BLOCKED`), thực hiện thu hồi phiên (`refresh_token = NULL`) và phát socket `force_logout`.
  - `PATCH /api/v2/admin/user/:id/profile`: Đóng gói việc cập nhật thông tin cá nhân (họ tên, SĐT, email) và chèn bản ghi kiểm toán (`action = 'UPDATE_PROFILE'`) trong cùng một Database Transaction. Sửa lỗi so sánh tên (`existingUser.name` -> `full_name`) để đảm bảo phát hiện chính xác thay đổi.
- **Thêm mới 1 API truy vấn lịch sử**:
  - `GET /api/v2/admin/user/:id/history`: Cung cấp danh sách lịch sử các lần Admin can thiệp vào tài khoản của người dùng (bao gồm thông tin Admin thực hiện, hành động, lý do, dữ liệu trước/sau thay đổi và thời gian thực hiện, hỗ trợ phân trang).
- **Không làm gián đoạn hay thay đổi URL/method của các API hiện tại**: Đảm bảo toàn bộ ứng dụng Web Admin đang chạy không bị ảnh hưởng.

## Capabilities

### New Capabilities
<!-- Không tạo capability mới vì miền quản trị người dùng đã thuộc admin-user -->

### Modified Capabilities
- `admin-user`: Bổ sung yêu cầu lưu vết kiểm toán tự động (Audit Logging) khi Admin cập nhật trạng thái hoặc thông tin người dùng vào bảng `admin_user_change_history`, đồng thời bổ sung API truy vấn lịch sử thay đổi của người dùng.

## Impact

- **Backend Controller**:
  - `backend/src/admin/user/user.controller.js`: Trích xuất `adminId` từ `req.user.user_id` và thêm method `getUserChangeHistory`.
- **Backend Service**:
  - `backend/src/admin/user/user.service.js`: Bắt buộc validate `reason`, chuẩn bị payload `old_values`/`new_values`, và thêm hàm `getUserChangeHistory`.
- **Backend Repository**:
  - `backend/src/admin/user/user.repository.js`: Thêm hàm Transactional update kèm insert log `admin_user_change_history`, thêm hàm truy vấn lịch sử JOIN với bảng `users` để lấy tên Admin.
- **Backend Routes**:
  - `backend/src/admin/user/user.routes.js`: Khai báo thêm endpoint `GET /:id/history`.
- **Database**:
  - Sử dụng bảng hiện có `admin_user_change_history` mà không cần sửa đổi schema hay migration mới.
