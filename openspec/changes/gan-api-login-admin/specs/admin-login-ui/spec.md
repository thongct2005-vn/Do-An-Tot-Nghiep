# Spec Delta: admin-login-ui

## MODIFIED Requirements

### Requirement: Kiểm tra tính hợp lệ của dữ liệu nhập tại giao diện
Hệ thống SHALL kiểm tra tính hợp lệ của biểu mẫu đăng nhập ngay trên giao diện trước khi kích hoạt quy trình gửi yêu cầu xác thực. Nếu trường Email quản trị hoặc Mật khẩu bị để trống, hoặc email không đúng định dạng RFC, hệ thống MUST hiển thị viền đỏ cảnh báo tại trường tương ứng, xuất hiện thông báo lỗi inline ngay bên dưới trường và hiển thị thanh banner cảnh báo ở đầu biểu mẫu.

#### Scenario: Để trống tên đăng nhập khi nhấn nút Đăng nhập
- **WHEN** Quản trị viên để trống trường Email quản trị và nhấn nút Đăng nhập
- **THEN** Hệ thống hiển thị viền đỏ quanh ô Email quản trị, xuất hiện thông báo 'Vui lòng nhập email quản trị' và hiển thị banner cảnh báo trên đầu biểu mẫu

#### Scenario: Để trống mật khẩu khi nhấn nút Đăng nhập
- **WHEN** Quản trị viên nhập email hợp lệ nhưng để trống trường Mật khẩu và nhấn nút Đăng nhập
- **THEN** Hệ thống hiển thị viền đỏ quanh ô Mật khẩu, xuất hiện thông báo 'Vui lòng nhập mật khẩu' và không kích hoạt trạng thái loading

#### Scenario: Nhập email quản trị không đúng định dạng
- **WHEN** Quản trị viên nhập chuỗi ký tự không đúng định dạng email (ví dụ: thiếu @ hoặc domain) và nhấn nút Đăng nhập
- **THEN** Hệ thống hiển thị viền đỏ quanh ô Email quản trị, xuất hiện thông báo 'Định dạng email không hợp lệ' và ngăn chặn việc gửi request lên máy chủ

### Requirement: Mô phỏng trạng thái xác thực và phản hồi giao diện
Hệ thống SHALL kết nối trực tiếp đến endpoint API `POST /api/v2/auth/admin/login` để xác thực Quản trị viên thay thế cho cơ chế mô phỏng giả lập. Khi gửi yêu cầu, nút Đăng nhập MUST chuyển sang trạng thái Loading (vô hiệu hóa tương tác, hiển thị con quay tiến trình và đổi nhãn thành 'Đang xác thực tài khoản...'). Khi nhận phản hồi từ Backend, hệ thống MUST hiển thị banner thông báo tương ứng với trạng thái kết quả.

#### Scenario: Kích hoạt trạng thái loading khi gửi biểu mẫu hợp lệ
- **WHEN** Quản trị viên nhấn nút Đăng nhập với đầy đủ email hợp lệ và mật khẩu
- **THEN** Nút Đăng nhập chuyển sang trạng thái vô hiệu hóa, hiển thị vòng quay tiến trình và nhãn nút đổi thành 'Đang xác thực tài khoản...'

#### Scenario: Hiển thị thông báo xác thực thành công sau thời gian giả lập
- **WHEN** Máy chủ backend xác thực thành công và trả về mã HTTP 200 kèm JWT token
- **THEN** Hệ thống hiển thị banner màu xanh lá với thông báo 'Đăng nhập Admin thành công! Đang chuyển hướng đến Dashboard...'

#### Scenario: Hiển thị thông báo lỗi khi mật khẩu không chính xác (400)
- **WHEN** Máy chủ backend phản hồi mã lỗi 400 do sai mật khẩu
- **THEN** Hệ thống hiển thị banner màu đỏ thông báo 'Mật khẩu không chính xác' kèm số lần thử còn lại và mở khóa lại nút Đăng nhập

#### Scenario: Hiển thị thông báo lỗi khi tài khoản bị tạm khóa (403)
- **WHEN** Quản trị viên nhập sai liên tiếp 5 lần hoặc gửi yêu cầu khi tài khoản đang trong thời hạn tạm khóa 30 phút
- **THEN** Hệ thống hiển thị banner cảnh báo bảo mật màu đỏ với thông báo 'Tài khoản bị tạm khóa'

#### Scenario: Hiển thị thông báo khi tài khoản không có quyền Quản trị viên (403)
- **WHEN** Người dùng sử dụng tài khoản có vai trò USER hoặc MERCHANT để đăng nhập
- **THEN** Hệ thống hiển thị banner cảnh báo màu đỏ với thông báo 'Tài khoản không có quyền Quản trị viên'

#### Scenario: Hiển thị thông báo khi tài khoản không tồn tại (404)
- **WHEN** Quản trị viên nhập email không tồn tại trong hệ thống
- **THEN** Hệ thống hiển thị banner màu đỏ với thông báo 'Tài khoản không tồn tại'

#### Scenario: Hiển thị thông báo khi vượt quá tần suất thao tác (429)
- **WHEN** Quản trị viên gửi yêu cầu đăng nhập vượt quá 20 lần trong vòng 15 phút
- **THEN** Hệ thống hiển thị banner cảnh báo màu đỏ thông báo 'Bạn thao tác quá nhiều lần, vui lòng thử lại sau'

### Requirement: Điều hướng demo vào Dashboard sau khi xác thực thành công
Hệ thống SHALL lưu trữ phiên làm việc của Quản trị viên (gồm JWT Access Token, Refresh Token và thông tin `admin_info`) vào trạng thái ứng dụng sau khi xác thực thành công qua API, đồng thời tự động điều hướng sang `AdminShell` chứa `DashboardScreen`.

#### Scenario: Chuyển hướng vào Dashboard sau đăng nhập thành công
- **WHEN** Đăng nhập API thành công và hoàn tất độ trễ thông báo 600ms
- **THEN** Ứng dụng lưu giữ thông tin phiên quản trị viên, giao diện chuyển mượt mà sang `AdminShell` và hiển thị đầy đủ tổng quan Dashboard

### Requirement: Khởi tạo trường nhập liệu ở trạng thái rỗng
Hệ thống SHALL khởi tạo giá trị ban đầu của ô Email quản trị và Mật khẩu ở trạng thái rỗng. Hệ thống MUST hiển thị văn bản gợi ý (placeholder) 'Nhập email quản trị' và 'Nhập mật khẩu', đồng thời cho phép người dùng tự do nhập liệu thực tế.

#### Scenario: Mở màn hình với hai trường nhập liệu trống
- **WHEN** Quản trị viên mở màn hình đăng nhập
- **THEN** Hai trường Email quản trị và Mật khẩu không chứa dữ liệu gán sẵn và hiển thị văn bản gợi ý mờ tương ứng
