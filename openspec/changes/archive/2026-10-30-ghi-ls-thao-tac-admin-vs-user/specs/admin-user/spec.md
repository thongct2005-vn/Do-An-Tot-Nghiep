# Spec Delta

## ADDED Requirements

### Requirement: Ghi nhận lịch sử kiểm toán thay đổi người dùng
Hệ thống SHALL tự động ghi nhận một bản ghi kiểm toán vào bảng `admin_user_change_history` mỗi khi Quản trị viên thực hiện cập nhật trạng thái hoặc chỉnh sửa thông tin của người dùng. Thao tác cập nhật người dùng và ghi lịch sử MUST được thực hiện trong cùng một Database Transaction để đảm bảo tính nhất quán dữ liệu. Bản ghi MUST lưu trữ chính xác định danh quản trị viên thực hiện, người dùng bị tác động, hành động, lý do bắt buộc, cùng dữ liệu trước và sau thay đổi ở định dạng JSONB.

#### Scenario: Ghi lịch sử khi thay đổi trạng thái người dùng
- **WHEN** Quản trị viên gửi yêu cầu `PATCH /api/v2/admin/user/:id/status` với trạng thái mới và lý do hợp lệ
- **THEN** Hệ thống cập nhật trạng thái người dùng trong bảng `users`, đồng thời chèn một bản ghi vào bảng `admin_user_change_history` với `action = 'UPDATE_STATUS'`, `reason` tương ứng, `old_values` chứa trạng thái cũ và `new_values` chứa trạng thái mới trong cùng một transaction

#### Scenario: Ghi lịch sử khi cập nhật thông tin cá nhân người dùng
- **WHEN** Quản trị viên gửi yêu cầu `PATCH /api/v2/admin/user/:id/profile` với thông tin thay đổi và lý do hợp lệ
- **THEN** Hệ thống cập nhật thông tin người dùng trong bảng `users`, đồng thời chèn một bản ghi vào bảng `admin_user_change_history` với `action = 'UPDATE_PROFILE'`, `reason` tương ứng, `old_values` chứa snapshot thông tin cũ và `new_values` chứa snapshot thông tin mới trong cùng một transaction

#### Scenario: Rollback toàn bộ khi quá trình ghi lịch sử gặp lỗi
- **WHEN** Quá trình ghi nhận vào bảng `admin_user_change_history` phát sinh lỗi cơ sở dữ liệu
- **THEN** Hệ thống MUST hủy bỏ (ROLLBACK) toàn bộ giao dịch, không lưu các thay đổi trên bảng `users` và trả về mã lỗi 500 cho phía gọi

#### Scenario: Từ chối thay đổi trạng thái khi thiếu lý do
- **WHEN** Quản trị viên gửi yêu cầu `PATCH /api/v2/admin/user/:id/status` nhưng không cung cấp `reason` hoặc `reason` chỉ chứa khoảng trắng
- **THEN** Hệ thống MUST từ chối xử lý, không thay đổi trạng thái người dùng, không ghi log và trả về mã lỗi `400 Bad Request`

### Requirement: Truy vấn lịch sử thay đổi của người dùng
Hệ thống SHALL cung cấp API cho phép Quản trị viên tra cứu toàn bộ lịch sử các lần thay đổi của một tài khoản người dùng cụ thể. API MUST yêu cầu xác thực bằng Access Token của tài khoản có vai trò `ADMIN`. Dữ liệu trả về MUST được sắp xếp theo thời gian mới nhất trước và bao gồm thông tin quản trị viên thực hiện (họ tên, email), loại hành động, lý do, thời gian thực hiện cùng chi tiết dữ liệu trước và sau thay đổi.

#### Scenario: Quản trị viên lấy danh sách lịch sử thay đổi thành công
- **WHEN** Quản trị viên gửi yêu cầu `GET /api/v2/admin/user/:id/history` với token Admin hợp lệ cho một người dùng tồn tại
- **THEN** Hệ thống trả về mã trạng thái 200 kèm danh sách các bản ghi lịch sử từ bảng `admin_user_change_history` của người dùng đó kèm thông tin người thực hiện

#### Scenario: Truy vấn lịch sử của người dùng không tồn tại
- **WHEN** Quản trị viên gửi yêu cầu `GET /api/v2/admin/user/:id/history` với một `id` người dùng không tồn tại trong hệ thống
- **THEN** Hệ thống trả về mã lỗi 404 với thông báo "Không tìm thấy người dùng"

#### Scenario: Người dùng không có quyền quản trị viên cố gắng truy cập lịch sử
- **WHEN** Một tài khoản có vai trò `USER` gửi yêu cầu đến `GET /api/v2/admin/user/:id/history`
- **THEN** Hệ thống từ chối truy cập và trả về mã lỗi 403 Forbidden
