# Proposal

## Why

Hiện tại, hệ thống Quản trị viên (Admin) chỉ cấp phát cặp token (Access Token 15 phút, Refresh Token 7 ngày) tại thời điểm đăng nhập nhưng chưa có các endpoint để gia hạn token, kiểm tra phiên hay thu hồi phiên làm việc. Điều này khiến phiên làm việc của Quản trị viên bị gián đoạn mỗi khi Access Token hết hạn sau 15 phút (gặp lỗi 401 trên mọi API quản trị) hoặc khi tải lại trang web (F5), buộc người dùng phải đăng nhập lại nhiều lần bằng email và mật khẩu.

Việc bổ sung cơ chế duy trì đăng nhập (Session Maintenance) hoàn chỉnh sẽ đảm bảo trải nghiệm liền mạch cho Quản trị viên, hỗ trợ tự động gia hạn phiên làm việc và đăng xuất an toàn.

## What Changes

- Bổ sung endpoint `POST /api/v2/admin/auth/refresh-token` cho phép cấp mới Access Token và Refresh Token xoay vòng (Token Rotation) khi Access Token cũ hết hạn.
- Bổ sung endpoint `GET /api/v2/admin/auth/me` để xác thực tính hợp lệ của phiên làm việc hiện tại và khôi phục thông tin cá nhân của Quản trị viên khi mở lại ứng dụng hoặc tải lại trang (F5).
- Bổ sung endpoint `POST /api/v2/admin/auth/logout` để đăng xuất chủ động và vô hiệu hóa `refresh_token` trong cơ sở dữ liệu (`refresh_token = NULL`).
- Tích hợp lớp Repository, Service, Controller và Routes trong `backend/src/admin/auth` theo đúng kiến trúc chuẩn của dự án.
- Cập nhật tài liệu cấu hình API endpoints cho Web Admin.

## Capabilities

### New Capabilities

### Modified Capabilities
- `admin-auth`: Bổ sung các yêu cầu nghiệp vụ về gia hạn token bằng refresh token (Silent Refresh với Token Rotation), khôi phục phiên làm việc (`/me`), và thu hồi phiên làm việc khi đăng xuất (`/logout`).

## Impact

- **Backend APIs**:
  - Mới: `POST /api/v2/admin/auth/refresh-token`
  - Mới: `GET /api/v2/admin/auth/me`
  - Mới: `POST /api/v2/admin/auth/logout`
- **Mã nguồn bị ảnh hưởng**:
  - `backend/src/admin/auth/auth.repository.js`
  - `backend/src/admin/auth/auth.service.js`
  - `backend/src/admin/auth/auth.controller.js`
  - `backend/src/admin/auth/auth.routes.js`
- **Cơ sở dữ liệu**: Sử dụng trường `refresh_token` hiện có trên bảng `users` (không cần migration DB mới).
- **Hệ thống liên quan**: `web-admin` sẽ có đầy đủ các endpoint để lưu trữ session bền vững và tự động refresh token khi gặp lỗi 401.
