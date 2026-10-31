# Spec Delta

## ADDED Requirements

### Requirement: Quản trị viên cập nhật trực tiếp thông tin người dùng
Hệ thống SHALL cung cấp API và giao diện Web Admin cho phép Quản trị viên cập nhật trực tiếp thông tin cá nhân của người dùng (`role = 'USER'`) bao gồm Họ và tên (`full_name`), Số điện thoại (`phone`), và Email (`email`). Thao tác MUST yêu cầu xác thực bằng Access Token của tài khoản có vai trò `ADMIN` và bắt buộc cung cấp lý do chỉnh sửa (`reason`).

#### Scenario: Cập nhật thông tin người dùng thành công
- **WHEN** Quản trị viên gửi yêu cầu `PATCH /api/v2/admin/user/:id/profile` với dữ liệu hợp lệ (họ tên, SĐT chưa trùng, email chưa trùng, lý do chỉnh sửa đầy đủ)
- **THEN** Hệ thống lưu thông tin mới vào bảng `users`, cập nhật `updated_at`, và trả về mã `200 OK` kèm toàn bộ dữ liệu chi tiết người dùng đã cập nhật

#### Scenario: Tự động tính toán phone_hash khi đổi số điện thoại
- **WHEN** Quản trị viên thay đổi số điện thoại của người dùng sang một số điện thoại mới hợp lệ
- **THEN** Hệ thống MUST tự động tính toán lại `phone_hash` bằng thuật toán SHA-256 từ số điện thoại mới và lưu vào cơ sở dữ liệu để đảm bảo các tính năng tra cứu danh bạ ví vẫn hoạt động chính xác

#### Scenario: Ngắt phiên đăng nhập cũ và phát socket force_logout
- **WHEN** Quản trị viên cập nhật thành công số điện thoại hoặc email của người dùng
- **THEN** Hệ thống MUST đặt `refresh_token = NULL` và `fcm_token = NULL` của tài khoản đó, đồng thời kích hoạt sự kiện Socket.io `force_logout` với thông điệp lý do tới thiết bị người dùng

#### Scenario: Từ chối khi trùng số điện thoại hoặc email
- **WHEN** Quản trị viên cập nhật số điện thoại hoặc email mà giá trị mới đã thuộc về một tài khoản người dùng khác trong hệ thống
- **THEN** Hệ thống MUST từ chối yêu cầu và trả về lỗi `409 Conflict` kèm thông tin trường bị trùng lặp

#### Scenario: Từ chối khi thiếu lý do chỉnh sửa
- **WHEN** Quản trị viên gửi yêu cầu cập nhật thông tin nhưng không cung cấp trường `reason` hoặc `reason` bị rỗng
- **THEN** Hệ thống MUST từ chối yêu cầu và trả về mã lỗi `400 Bad Request`

### Requirement: Giao diện hộp thoại chỉnh sửa thông tin trên Web Admin
Hệ thống SHALL hiển thị nút "Chỉnh sửa" tại thẻ Thông tin định danh & bảo mật trong `UserDetailDrawer`. Khi nhấn vào, hệ thống MUST hiển thị hộp thoại `EditUserProfileDialog` cho phép nhập Họ tên, Số điện thoại, Email và Lý do chỉnh sửa kèm cơ chế kiểm tra tính hợp lệ trước khi gửi yêu cầu. Khi cập nhật thành công, giao diện Drawer và bảng danh sách MUST tự động cập nhật dữ liệu mới mà không cần tải lại toàn bộ trang.

#### Scenario: Mở hộp thoại chỉnh sửa với dữ liệu khởi tạo
- **WHEN** Quản trị viên nhấn nút "Chỉnh sửa" tại thẻ Thông tin định danh trong Drawer chi tiết người dùng
- **THEN** Hộp thoại hiển thị form với các trường Họ tên, SĐT, Email được điền sẵn theo dữ liệu hiện tại của người dùng và ô Lý do chỉnh sửa để trống

#### Scenario: Cập nhật giao diện tức thì sau khi lưu thành công
- **WHEN** Quản trị viên điền form hợp lệ và nhấn "Lưu thay đổi", nhận phản hồi thành công từ API
- **THEN** Hộp thoại đóng lại, hiển thị thông báo SnackBar thành công, dữ liệu trong Drawer và dòng tương ứng trên bảng danh sách người dùng được cập nhật ngay lập tức
