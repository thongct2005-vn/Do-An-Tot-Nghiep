# admin-auth Specification

## Purpose

Cung cấp cơ chế xác thực danh tính và cấp quyền truy cập dành riêng cho Quản trị viên (ADMIN) thông qua email và mật khẩu trên hệ thống ví điện tử.

## Requirements

### Requirement: Đăng nhập quản trị viên bằng Email và Mật khẩu
Hệ thống SHALL cung cấp endpoint `POST /api/v2/auth/admin/login` cho phép quản trị viên đăng nhập vào hệ thống bằng địa chỉ email và mật khẩu.

#### Scenario: Đăng nhập thành công với thông tin hợp lệ
- **WHEN** Quản trị viên gửi request đăng nhập với email hợp lệ và mật khẩu chính xác
- **THEN** Hệ thống trả về mã trạng thái 200 kèm access token, refresh token và thông tin quản trị viên

#### Scenario: Đăng nhập thất bại do mật khẩu không chính xác
- **WHEN** Quản trị viên gửi request với email tồn tại nhưng mật khẩu không đúng
- **THEN** Hệ thống trả về mã lỗi 400 và giảm số lần thử đăng nhập còn lại

#### Scenario: Đăng nhập thất bại do tài khoản không tồn tại
- **WHEN** Người dùng gửi request với email không tồn tại trong hệ thống
- **THEN** Hệ thống trả về mã lỗi 404 với thông báo tài khoản không tồn tại

### Requirement: Kiểm tra vai trò và trạng thái tài khoản
Hệ thống SHALL kiểm tra tài khoản đăng nhập phải có vai trò ADMIN và trạng thái hoạt động ACTIVE, đồng thời từ chối mọi tài khoản không đáp ứng đủ điều kiện với mã lỗi 403.

#### Scenario: Từ chối tài khoản không phải vai trò ADMIN
- **WHEN** Người dùng gửi thông tin đăng nhập chính xác của một tài khoản có vai trò USER hoặc MERCHANT
- **THEN** Hệ thống từ chối đăng nhập với mã lỗi 403 và thông báo tài khoản không có quyền Quản trị viên

#### Scenario: Từ chối tài khoản có trạng thái không phải ACTIVE
- **WHEN** Quản trị viên gửi thông tin đăng nhập đúng của một tài khoản ADMIN đang có trạng thái khác ACTIVE
- **THEN** Hệ thống từ chối đăng nhập với mã lỗi 403 và thông báo tài khoản bị khóa

### Requirement: Khóa tạm thời tài khoản khi nhập sai liên tiếp
Hệ thống SHALL tự động tạm khóa tài khoản trong vòng 30 phút sau khi ghi nhận 5 lần nhập sai mật khẩu liên tiếp dựa trên địa chỉ email.

#### Scenario: Tạm khóa tài khoản sau 5 lần nhập sai
- **WHEN** Quản trị viên nhập sai mật khẩu lần thứ 5 liên tiếp
- **THEN** Hệ thống cập nhật thời gian tạm khóa 30 phút và trả về mã lỗi 403 thông báo tài khoản bị tạm khóa

#### Scenario: Từ chối đăng nhập khi tài khoản đang trong thời gian tạm khóa
- **WHEN** Quản trị viên gửi yêu cầu đăng nhập trong khi thời hạn tạm khóa vẫn còn hiệu lực
- **THEN** Hệ thống từ chối đăng nhập với mã lỗi 403 mà không cần so khớp mật khẩu

### Requirement: Bảo vệ thông tin cá nhân và cấp Token
Hệ thống SHALL cấp JWT Access Token và Refresh Token cho tài khoản ADMIN, đồng thời loại bỏ hoàn toàn số điện thoại khỏi response body và JWT payload.

#### Scenario: Response không chứa số điện thoại của quản trị viên
- **WHEN** Quản trị viên đăng nhập thành công
- **THEN** Trường `admin_info` trong dữ liệu phản hồi chỉ bao gồm `user_id`, `email`, `full_name`, `role` và tuyệt đối không chứa trường `phone`

#### Scenario: JWT payload không chứa số điện thoại
- **WHEN** Hệ thống ký cấp JWT Access Token cho quản trị viên
- **THEN** Dữ liệu payload bên trong token chứa định danh role ADMIN và không chứa thuộc tính `phone`
