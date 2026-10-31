# Spec Delta

## ADDED Requirements

### Requirement: Lưu trữ phiên làm việc an toàn tại client
Hệ thống SHALL lưu trữ thông tin phiên làm việc gồm Access Token, Refresh Token và dữ liệu Quản trị viên vào bộ nhớ bền vững (SharedPreferences / LocalStorage) ngay sau khi xác thực thành công.

#### Scenario: Tự động lưu phiên sau khi đăng nhập thành công
- **WHEN** Quản trị viên đăng nhập thành công với tài khoản ADMIN hợp lệ
- **THEN** Hệ thống lưu trữ Access Token, Refresh Token và thông tin Quản trị viên vào LocalStorage trước khi điều hướng vào Dashboard

#### Scenario: Xóa sạch dữ liệu phiên khi đăng xuất
- **WHEN** Quản trị viên thực hiện đăng xuất khỏi hệ thống
- **THEN** Hệ thống xóa sạch toàn bộ token và thông tin phiên làm việc khỏi LocalStorage

### Requirement: Tự động khôi phục phiên khi khởi động hoặc tải lại trang web
Hệ thống SHALL tự động kiểm tra LocalStorage khi ứng dụng khởi động hoặc khi người dùng nhấn F5 reload trang, gửi yêu cầu đến `GET /api/v2/admin/auth/me` để xác thực và khôi phục trạng thái làm việc của Quản trị viên.

#### Scenario: Khôi phục phiên thành công khi nhấn F5 hoặc mở lại tab
- **WHEN** Quản trị viên nhấn F5 tải lại trang web trong khi phiên làm việc còn hiệu lực
- **THEN** Hệ thống đọc token từ LocalStorage, xác thực phiên thành công với backend và hiển thị giao diện Quản trị mà không bắt đăng nhập lại

#### Scenario: Điều hướng về màn hình Đăng nhập khi không có phiên lưu trữ
- **WHEN** Người dùng mở ứng dụng và không tìm thấy phiên lưu trữ hợp lệ trong LocalStorage
- **THEN** Hệ thống hiển thị màn hình Đăng nhập Quản trị viên

#### Scenario: Tự động gia hạn token khi Access Token lưu trữ hết hạn
- **WHEN** Quản trị viên tải lại trang với Access Token đã hết hạn nhưng Refresh Token còn hạn hợp lệ
- **THEN** Hệ thống tự động gia hạn token mới qua API refresh-token, cập nhật LocalStorage và giữ trạng thái đăng nhập thành công
