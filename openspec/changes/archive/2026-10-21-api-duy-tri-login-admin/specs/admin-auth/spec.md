# Spec Delta

## ADDED Requirements

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
