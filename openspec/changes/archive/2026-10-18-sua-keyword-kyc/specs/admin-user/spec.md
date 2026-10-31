# Spec Delta

## MODIFIED Requirements

### Requirement: Danh sách và tìm kiếm người dùng
Hệ thống SHALL hiển thị bảng danh sách người dùng bao gồm các trường: Họ tên & Avatar, Số điện thoại ví, Trạng thái KYC, Số dư khả dụng (JetBrains Mono căn phải), Trạng thái tài khoản (Badge: Đang hoạt động / Đã khóa), và Ngày tạo. Trạng thái KYC MUST phản ánh chính xác theo dữ liệu cơ sở dữ liệu: người dùng có trạng thái `APPROVED` hiển thị badge "Đã xác thực", người dùng có trạng thái `null` hoặc không có hồ sơ hiển thị badge "Chưa định danh". Hệ thống MUST cung cấp ô tìm kiếm tại toolbar cho phép lọc danh sách theo Họ tên hoặc Số điện thoại người dùng.

#### Scenario: Hiển thị trạng thái KYC cho tài khoản đã xác thực
- **WHEN** Quản trị viên xem danh sách người dùng và có tài khoản đã hoàn thành KYC với trạng thái `APPROVED` (như Phan Văn Thống)
- **THEN** Cột Trạng thái KYC của tài khoản đó hiển thị badge màu xanh lá với nhãn "Đã xác thực"

#### Scenario: Hiển thị trạng thái KYC cho tài khoản chưa xác thực
- **WHEN** Quản trị viên xem danh sách người dùng và có tài khoản có trạng thái KYC là `null` hoặc chưa nộp hồ sơ KYC
- **THEN** Cột Trạng thái KYC của tài khoản đó hiển thị badge màu đỏ với nhãn "Chưa định danh"

#### Scenario: Tìm kiếm người dùng theo số điện thoại
- **WHEN** Quản trị viên nhập số điện thoại "0901234567" vào ô tìm kiếm
- **THEN** Bảng danh sách người dùng chỉ hiển thị những bản ghi có số điện thoại hoặc họ tên khớp với chuỗi tìm kiếm
