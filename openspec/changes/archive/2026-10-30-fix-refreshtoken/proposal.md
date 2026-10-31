# Proposal: Chặn làm mới token với tài khoản User không còn ACTIVE

## Why

Luồng làm mới token của app ví (`POST /refresh-token` trong `modules/auth`) chỉ tìm user theo `refresh_token` mà không kiểm tra `status`. Hiện tại tài khoản bị khóa vẫn bị chặn, nhưng chỉ vì lúc Admin khóa thì `refresh_token` bị xóa. Nếu tài khoản bị khóa bằng cách khác mà token chưa bị xóa (ví dụ sửa thẳng trong DB), user vẫn làm mới token được. Ngoài ra câu báo lỗi trả về ("đã đăng nhập trên thiết bị khác") không đúng với lý do thật.

## What Changes

- `findUserByRefreshToken` trả thêm cột `status` của user (không lọc trong SQL).
- `authService.refreshToken` kiểm tra `status`. Nếu khác `ACTIVE` thì trả **403** "Tài khoản bị khóa" và không cấp token mới. Câu báo lỗi giống luồng đăng nhập (`auth.service.js:L42-44`).
- Trường hợp không tìm thấy token giữ nguyên: vẫn trả 401 với câu báo cũ.
- **Đổi hành vi API:** với tài khoản bị khóa mà còn token hợp lệ, endpoint trả 403 thay vì cấp token mới. App Flutter vẫn đăng xuất bình thường, vì nó coi mọi lỗi khi gọi refresh là thất bại (`api_client.dart:L101-103`).

Ngoài phạm vi:
- Hàm trùng tên trong `admin/merchant/sandbox/user/auth`.
- Luồng refresh của Admin và Merchant production.
- Việc `verifyAccessToken` không đọc DB (access token cũ vẫn dùng được tối đa 15 phút).

## Capabilities

### New Capabilities
- `user-auth`: Xác thực phiên đăng nhập của người dùng app ví (role `USER`), bắt đầu bằng yêu cầu cho luồng làm mới token.

### Modified Capabilities
(Không có)

## Impact

- `backend/src/modules/auth/auth.repository.js`: hàm `findUserByRefreshToken` (L161-171) thêm `u.status` vào `SELECT`.
- `backend/src/modules/auth/auth.service.js`: hàm `refreshToken` (L310-330) thêm bước kiểm tra trạng thái.
- `backend/tests/`: thêm file test cho `authService.refreshToken`, viết theo kiểu `node:test` đang dùng.
- Không đổi schema DB và không thêm thư viện. Client Flutter không cần sửa.

