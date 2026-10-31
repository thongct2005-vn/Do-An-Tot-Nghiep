# Spec Delta

## MODIFIED Requirements

### Requirement: Danh sách và tìm kiếm người dùng
Hệ thống SHALL cung cấp API endpoint `GET /api/v2/admin/user` kết nối cơ sở dữ liệu để hiển thị bảng danh sách người dùng bao gồm các trường: Họ tên & Avatar, Số điện thoại ví, Trạng thái KYC, Số dư khả dụng (JetBrains Mono căn phải), Trạng thái tài khoản (Badge: Đang hoạt động / Đã khóa), và Ngày tạo. Hệ thống MUST cung cấp ô tìm kiếm và phân trang cho phép lọc danh sách theo Họ tên, Số điện thoại hoặc Email người dùng.

#### Scenario: Tìm kiếm người dùng theo số điện thoại
- **WHEN** Quản trị viên nhập số điện thoại "0901234567" vào ô tìm kiếm
- **THEN** Hệ thống gửi request API và bảng danh sách người dùng chỉ hiển thị những bản ghi có số điện thoại hoặc họ tên khớp với chuỗi tìm kiếm

### Requirement: Hộp thoại xác nhận vô hiệu hóa người dùng
Hệ thống SHALL hiển thị hộp thoại xác nhận khi quản trị viên chọn thao tác khóa/vô hiệu hóa tài khoản và gửi yêu cầu `PATCH /api/v2/admin/user/:id/status` để cập nhật trạng thái trong cơ sở dữ liệu. Hộp thoại MUST bắt buộc nhập lý do vô hiệu hóa trước khi kích hoạt nút xác nhận.

#### Scenario: Vô hiệu hóa tài khoản người dùng thành công
- **WHEN** Quản trị viên mở hộp thoại xác nhận, nhập lý do "Phát hiện gian lận giao dịch" và nhấn nút "Vô hiệu hóa tài khoản"
- **THEN** Hệ thống gửi request PATCH cập nhật trạng thái người dùng sang "Đã khóa" trong database và cập nhật giao diện với badge màu đỏ

## ADDED Requirements

### Requirement: Thống kê tổng quan người dùng
Hệ thống SHALL cung cấp endpoint `GET /api/v2/admin/user/stats` trả về số lượng tài khoản người dùng theo trạng thái hoạt động và bị khóa.

#### Scenario: Lấy số liệu thống kê người dùng thành công
- **WHEN** Quản trị viên truy cập màn hình Quản lý người dùng
- **THEN** Hệ thống gửi request tới endpoint stats và hiển thị chính xác số tài khoản đang hoạt động và số tài khoản đã khóa
