# Spec Delta: admin-user

## Purpose

Cung cấp tính năng quản lý danh sách người dùng, tra cứu tài khoản, xem chi tiết thông tin ví qua Drawer và quy trình phê duyệt vô hiệu hóa tài khoản an toàn.

## ADDED Requirements

### Requirement: Danh sách và tìm kiếm người dùng
Hệ thống SHALL hiển thị bảng danh sách người dùng bao gồm các trường: Họ tên & Avatar, Số điện thoại ví, Trạng thái KYC, Số dư khả dụng (JetBrains Mono căn phải), Trạng thái tài khoản (Badge: Đang hoạt động / Đã khóa), và Ngày tạo. Hệ thống MUST cung cấp ô tìm kiếm tại toolbar cho phép lọc danh sách theo Họ tên hoặc Số điện thoại người dùng.

#### Scenario: Tìm kiếm người dùng theo số điện thoại
- **WHEN** Quản trị viên nhập số điện thoại "0901234567" vào ô tìm kiếm
- **THEN** Bảng danh sách người dùng chỉ hiển thị những bản ghi có số điện thoại hoặc họ tên khớp với chuỗi tìm kiếm

### Requirement: Drawer hiển thị chi tiết người dùng tại chỗ
Hệ thống SHALL mở một ngăn trượt chi tiết (Slide-over Drawer) có chiều rộng 480px từ mép phải màn hình khi quản trị viên nhấp vào một dòng người dùng trong danh sách. Quá trình mở Drawer MUST diễn ra ngay tại màn hình danh sách mà không chuyển hướng trang. Drawer MUST hiển thị thông tin KYC, thẻ số dư và tài khoản liên kết, hạn mức giao dịch và nhật ký hoạt động.

#### Scenario: Mở Drawer chi tiết khi click dòng người dùng
- **WHEN** Quản trị viên nhấp vào dòng của người dùng "Nguyễn Văn A" trong bảng danh sách
- **THEN** Drawer chi tiết người dùng trượt ra từ mép phải với độ rộng 480px, hiển thị đầy đủ thông tin KYC, số dư và nhật ký kiểm toán của người dùng đó

#### Scenario: Đóng Drawer chi tiết
- **WHEN** Quản trị viên nhấn nút Đóng hoặc nhấp vào vùng làm mờ bên ngoài Drawer
- **THEN** Drawer thu gọn và đóng lại, giao diện danh sách người dùng trở về trạng thái bình thường

### Requirement: Hộp thoại xác nhận vô hiệu hóa người dùng
Hệ thống SHALL hiển thị hộp thoại xác nhận dạng cảnh báo nguy hiểm (Destructive Confirmation Dialog) độ rộng 440px khi quản trị viên chọn thao tác khóa/vô hiệu hóa tài khoản. Hộp thoại MUST hiển thị icon cảnh báo màu đỏ (#EF4444), cảnh báo hệ quả phong tỏa ví và bắt buộc người dùng nhập lý do vô hiệu hóa trước khi kích hoạt nút xác nhận.

#### Scenario: Vô hiệu hóa tài khoản người dùng thành công
- **WHEN** Quản trị viên mở hộp thoại xác nhận, nhập lý do "Phát hiện gian lận giao dịch" và nhấn nút "Vô hiệu hóa tài khoản"
- **THEN** Trạng thái người dùng được cập nhật sang "Đã khóa" với badge màu đỏ và hộp thoại đóng lại
