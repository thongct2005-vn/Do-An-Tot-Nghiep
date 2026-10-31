# Spec Delta

## MODIFIED Requirements

### Requirement: Đăng nhập quản trị viên bằng Email và Mật khẩu
Hệ thống SHALL cung cấp endpoint `POST /api/v2/admin/auth/login` cho phép quản trị viên đăng nhập vào hệ thống bằng địa chỉ email và mật khẩu.

#### Scenario: Đăng nhập thành công với thông tin hợp lệ
- **WHEN** Quản trị viên gửi request đăng nhập đến endpoint `POST /api/v2/admin/auth/login` với email hợp lệ và mật khẩu chính xác
- **THEN** Hệ thống trả về mã trạng thái 200 kèm access token, refresh token và thông tin quản trị viên

#### Scenario: Đăng nhập thất bại do mật khẩu không chính xác
- **WHEN** Quản trị viên gửi request với email tồn tại nhưng mật khẩu không đúng
- **THEN** Hệ thống trả về mã lỗi 400 và giảm số lần thử đăng nhập còn lại

#### Scenario: Đăng nhập thất bại do tài khoản không tồn tại
- **WHEN** Người dùng gửi request với email không tồn tại trong hệ thống
- **THEN** Hệ thống trả về mã lỗi 404 với thông báo tài khoản không tồn tại
