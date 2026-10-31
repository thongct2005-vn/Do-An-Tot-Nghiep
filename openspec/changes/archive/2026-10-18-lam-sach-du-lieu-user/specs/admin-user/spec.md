# Spec Delta

## MODIFIED Requirements

### Requirement: Drawer hiển thị chi tiết người dùng tại chỗ
Hệ thống SHALL mở một ngăn trượt chi tiết (Slide-over Drawer) có chiều rộng 480px từ mép phải màn hình khi quản trị viên nhấp vào một dòng người dùng trong danh sách. Quá trình mở Drawer MUST diễn ra ngay tại màn hình danh sách mà không chuyển hướng trang. Drawer MUST hiển thị thông tin trung thực từ cơ sở dữ liệu bao gồm định danh KYC, thẻ số dư ví cá nhân, tài khoản ngân hàng liên kết thực tế, và khối thông tin an ninh phù hợp. Hệ thống MUST NOT sử dụng bất kỳ chuỗi mock fallback mặc định nào (như "Vietcombank **** 6899", "hoanglong.le@gmail.com", "001095012847", "0912.845.678") khi dữ liệu của người dùng bị rỗng hoặc chưa hoàn tất định danh.

#### Scenario: Mở Drawer chi tiết khi click dòng người dùng
- **WHEN** Quản trị viên nhấp vào dòng của người dùng trong bảng danh sách
- **THEN** Drawer chi tiết người dùng trượt ra từ mép phải với độ rộng 480px, hiển thị đầy đủ thông tin KYC, số dư và thông tin chi tiết của người dùng đó

#### Scenario: Đóng Drawer chi tiết
- **WHEN** Quản trị viên nhấn nút Đóng hoặc nhấp vào vùng làm mờ bên ngoài Drawer
- **THEN** Drawer thu gọn và đóng lại, giao diện danh sách người dùng trở về trạng thái bình thường

#### Scenario: Hiển thị thông tin ngân hàng cho tài khoản chưa liên kết
- **WHEN** Quản trị viên mở Drawer của người dùng chưa có tài khoản ngân hàng liên kết (hoặc danh sách ngân hàng liên kết rỗng)
- **THEN** Mục "Ngân hàng liên kết" MUST hiển thị nhãn "Chưa liên kết" với màu chữ xám (#64748B) và font weight bình thường, không hiển thị tên ngân hàng hoặc số tài khoản giả định

#### Scenario: Hiển thị thông tin ngân hàng cho tài khoản đã liên kết
- **WHEN** Quản trị viên mở Drawer của người dùng đã liên kết ngân hàng (như Vietcombank số tài khoản 0332330072 của người dùng Dương Gian)
- **THEN** Mục "Ngân hàng liên kết" hiển thị tên ngân hàng cùng 4 số cuối của tài khoản thực tế theo định dạng "<Tên ngân hàng> **** <4 số cuối>" (ví dụ: "Vietcombank **** 0072")

#### Scenario: Hiển thị thông tin định danh và an ninh cho tài khoản chưa KYC
- **WHEN** Quản trị viên mở Drawer của người dùng có trạng thái KYC là "Chưa xác minh KYC" và không có email/CCCD
- **THEN** Mục "Địa chỉ Email" hiển thị email thật hoặc "Chưa cập nhật", mục "CCCD / Định danh" hiển thị "Chưa cập nhật", và khối thông báo an ninh hiển thị cảnh báo tài khoản chưa hoàn tất xác thực danh tính theo quy định
