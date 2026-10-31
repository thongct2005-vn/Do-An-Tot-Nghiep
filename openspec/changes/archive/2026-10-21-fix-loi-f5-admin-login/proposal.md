# Proposal

## Why

Khi Quản trị viên tải lại trang (nhấn F5) hoặc mở lại tab trên Flutter Web Admin, toàn bộ phiên đăng nhập lưu trong bộ nhớ RAM bị giải phóng, khiến người dùng bị văng ra màn hình Đăng nhập (LoginScreen). Nguyên nhân là do Web Admin hiện tại chưa lưu trữ cặp JWT token xuống bộ nhớ bền vững của trình duyệt (LocalStorage / SharedPreferences), đồng thời thiếu cơ chế khôi phục phiên (Session Hydration) gọi API `GET /api/v2/admin/auth/me` khi ứng dụng khởi động lại.

Cần khắc phục lỗi này để Quản trị viên duy trì phiên làm việc liên tục, không bị ngắt quãng khi reload trang hoặc mở tab mới.

## What Changes

- Tích hợp dependency `shared_preferences` vào `web-admin/pubspec.yaml` để lưu trữ dữ liệu an toàn trên LocalStorage của trình duyệt.
- Xây dựng `AuthStorageService` cung cấp các phương thức lưu, đọc và xóa `accessToken`, `refreshToken`, và `adminInfo`.
- Cập nhật `AdminSessionModel` hỗ trợ chuyển đổi dữ liệu đầy đủ giữa Object và JSON.
- Mở rộng `AuthApiService` với các phương thức:
  - `getMe(accessToken)`: gọi API `GET /api/v2/admin/auth/me` để xác thực tính hợp lệ của token và lấy hồ sơ Quản trị viên.
  - `refreshToken(refreshToken)`: gọi API `POST /api/v2/admin/auth/refresh-token` để cấp mới token.
  - `logout(accessToken)`: gọi API `POST /api/v2/admin/auth/logout` để thu hồi token ở server.
- Cập nhật vòng đời khởi động trong `WebAdminApp` (`web-admin/lib/app.dart`):
  - Khi khởi động hoặc F5, kiểm tra token trong storage; nếu có, hiển thị trạng thái kiểm tra phiên và gọi `getMe()` để khôi phục phiên vào thẳng Dashboard.
  - Khi đăng nhập thành công, lưu token vào storage.
  - Khi đăng xuất, gọi API logout và dọn sạch storage.

## Capabilities

### New Capabilities

### Modified Capabilities
- `admin-login-ui`: Bổ sung yêu cầu lưu trữ phiên đăng nhập bền vững tại client và khôi phục trạng thái đăng nhập khi ứng dụng khởi động lại hoặc khi Quản trị viên nhấn F5 reload trang web.

## Impact

- **Mã nguồn bị ảnh hưởng**:
  - `web-admin/pubspec.yaml`
  - `web-admin/lib/features/auth/models/admin_session_model.dart`
  - `web-admin/lib/features/auth/data/auth_storage_service.dart` (mới)
  - `web-admin/lib/features/auth/data/auth_api_service.dart`
  - `web-admin/lib/app.dart`
- **Dependencies**: Thêm `shared_preferences` vào `web-admin`.
- **Backend APIs sử dụng**:
  - `GET /api/v2/admin/auth/me`
  - `POST /api/v2/admin/auth/refresh-token`
  - `POST /api/v2/admin/auth/logout`
