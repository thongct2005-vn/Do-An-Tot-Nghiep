# user-auth Specification

## Purpose

Quy định cách hệ thống xác thực và duy trì phiên đăng nhập của người dùng app ví điện tử (role USER), gồm điều kiện được cấp lại token.

## Requirements

### Requirement: Làm mới token chỉ dành cho tài khoản đang hoạt động
Hệ thống SHALL chỉ cấp cặp access token và refresh token mới khi refresh token gửi lên khớp với phiên đang lưu VÀ tài khoản sở hữu nó đang ở trạng thái `ACTIVE`. Khi tài khoản không ở trạng thái `ACTIVE`, hệ thống MUST từ chối với mã 403 và thông báo "Tài khoản bị khóa", giống thông báo của luồng đăng nhập. Hệ thống MUST NOT cấp hay lưu token mới trong trường hợp này.

#### Scenario: Tài khoản ACTIVE làm mới token thành công
- **WHEN** người dùng có trạng thái `ACTIVE` gửi refresh token hợp lệ và khớp phiên đang lưu
- **THEN** hệ thống trả về 200 kèm `access_token` và `refresh_token` mới, đồng thời refresh token cũ không còn dùng được

#### Scenario: Tài khoản bị khóa nhưng refresh token vẫn còn lưu
- **WHEN** người dùng có trạng thái khác `ACTIVE` (ví dụ `BLOCKED`) gửi refresh token hợp lệ, vẫn khớp phiên đang lưu
- **THEN** hệ thống trả về 403 với thông báo "Tài khoản bị khóa" và không cấp token mới
- **AND** refresh token đang lưu của người dùng không bị thay thế

#### Scenario: Refresh token không khớp phiên nào
- **WHEN** người dùng gửi refresh token có chữ ký hợp lệ nhưng không khớp phiên đang lưu (đã bị thu hồi hoặc bị thay bởi lần đăng nhập khác)
- **THEN** hệ thống trả về 401 với thông báo hiện có "Tài khoản của bạn đã được đăng nhập trên thiết bị khác. Vui lòng đăng nhập lại" và không cấp token mới

