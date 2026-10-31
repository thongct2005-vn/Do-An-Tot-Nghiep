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

### Requirement: Cấp lại Access Token cho Quản trị viên
Hệ thống SHALL cung cấp endpoint `POST /api/v2/admin/auth/refresh-token` cho phép Quản trị viên gia hạn Access Token mới bằng Refresh Token hợp lệ, đồng thời áp dụng cơ chế xoay vòng Refresh Token (Token Rotation) nhằm bảo mật phiên làm việc.

#### Scenario: Cấp lại token thành công với refresh token hợp lệ
- **WHEN** Quản trị viên gửi request kèm refresh token hợp lệ còn trong hạn và khớp với cơ sở dữ liệu
- **THEN** Hệ thống trả về mã 200 kèm Access Token mới và Refresh Token mới, đồng thời cập nhật Refresh Token mới vào cơ sở dữ liệu

#### Scenario: Từ chối cấp lại token khi refresh token không khớp cơ sở dữ liệu
- **WHEN** Quản trị viên gửi refresh token đã bị thu hồi hoặc đã bị thay thế ở phiên đăng nhập khác
- **THEN** Hệ thống trả về mã lỗi 401 thông báo phiên làm việc không hợp lệ hoặc đã đăng nhập ở thiết bị khác

#### Scenario: Từ chối cấp lại token khi refresh token hết hạn hoặc sai chữ ký
- **WHEN** Quản trị viên gửi refresh token đã quá hạn 7 ngày hoặc sai định dạng chữ ký
- **THEN** Hệ thống trả về mã lỗi 401 thông báo token không hợp lệ hoặc đã hết hạn

#### Scenario: Từ chối cấp lại token khi tài khoản bị khóa hoặc không phải Quản trị viên
- **WHEN** Quản trị viên gửi refresh token hợp lệ nhưng tài khoản có trạng thái khác ACTIVE hoặc vai trò không phải ADMIN
- **THEN** Hệ thống từ chối yêu cầu với mã lỗi 403

### Requirement: Xác thực và khôi phục thông tin phiên Quản trị viên
Hệ thống SHALL cung cấp endpoint `GET /api/v2/admin/auth/me` yêu cầu Access Token hợp lệ để kiểm tra tính hiệu lực của phiên làm việc hiện tại và trả về thông tin cá nhân của Quản trị viên.

#### Scenario: Lấy thông tin phiên thành công với Access Token hợp lệ
- **WHEN** Quản trị viên gửi request với Access Token hợp lệ còn thời hạn trong header Authorization
- **THEN** Hệ thống trả về mã trạng thái 200 kèm thông tin cá nhân gồm user_id, email, full_name, role và tuyệt đối không chứa trường phone

#### Scenario: Từ chối truy cập khi Access Token hết hạn hoặc không hợp lệ
- **WHEN** Quản trị viên gửi request với Access Token đã quá thời hạn 15 phút hoặc bị chỉnh sửa
- **THEN** Hệ thống trả về mã lỗi 401 thông báo token đã hết hạn hoặc không hợp lệ

#### Scenario: Từ chối truy cập khi tài khoản bị khóa
- **WHEN** Quản trị viên gửi Access Token hợp lệ nhưng tài khoản trong cơ sở dữ liệu có trạng thái khác ACTIVE
- **THEN** Hệ thống từ chối với mã lỗi 403 thông báo tài khoản bị khóa

### Requirement: Đăng xuất và thu hồi phiên làm việc Quản trị viên
Hệ thống SHALL cung cấp endpoint `POST /api/v2/admin/auth/logout` cho phép Quản trị viên chủ động chấm dứt phiên làm việc và thu hồi Refresh Token trong cơ sở dữ liệu.

#### Scenario: Đăng xuất thành công
- **WHEN** Quản trị viên gửi yêu cầu đăng xuất với Access Token hợp lệ
- **THEN** Hệ thống cập nhật trường refresh_token về NULL trong cơ sở dữ liệu và trả về mã trạng thái 200 thông báo đăng xuất thành công

#### Scenario: Từ chối đăng xuất khi thiếu thông tin xác thực
- **WHEN** Người dùng gửi yêu cầu đăng xuất nhưng không đính kèm Access Token hợp lệ trong header Authorization
- **THEN** Hệ thống trả về mã lỗi 401 thông báo thiếu thông tin xác thực

