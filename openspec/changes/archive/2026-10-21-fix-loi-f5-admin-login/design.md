# Design

## Context

Hệ thống Backend đã cung cấp đầy đủ các API quản lý phiên gồm `POST /api/v2/admin/auth/login`, `POST /api/v2/admin/auth/refresh-token`, `GET /api/v2/admin/auth/me`, và `POST /api/v2/admin/auth/logout`.
Tại frontend `web-admin`, trạng thái đăng nhập hiện chỉ được lưu trong biến state bộ nhớ RAM (`_adminSession`, `_isAuthenticated`). Khi Quản trị viên reload trang (F5), bộ nhớ RAM bị giải phóng khiến người dùng bị đưa về màn hình Đăng nhập mặc định.

## Goals / Non-Goals

**Goals:**
- Tích hợp `shared_preferences` để lưu trữ an toàn `AdminSessionModel` (gồm access_token, refresh_token, admin_info) trên trình duyệt web.
- Xây dựng `AuthStorageService` đóng gói các thao tác đọc/ghi/xóa phiên làm việc.
- Bổ sung các phương thức `getMe`, `refreshToken`, `logout` trong `AuthApiService`.
- Cập nhật luồng khởi động trong `web-admin/lib/app.dart` để tự động kiểm tra và khôi phục phiên (Session Hydration) khi mở app hoặc nhấn F5.
- Nếu token còn hạn: Khôi phục phiên và hiển thị thẳng DashboardScreen mà không gián đoạn.
- Nếu access token hết hạn: Thử tự động gia hạn ngầm (silent refresh); nếu thất bại thì xóa storage và điều hướng về LoginScreen.

**Non-Goals:**
- Không sửa đổi mã nguồn Backend hoặc cấu trúc database.
- Không thay đổi thiết kế giao diện đăng nhập hiện tại.

## Decisions

### Decision 1: Sử dụng thư viện `shared_preferences` làm giải pháp lưu trữ
- **Giải pháp**: Bổ sung `shared_preferences: ^2.3.0` vào `web-admin/pubspec.yaml`.
- **Lý do**: Đây là package chính thức của Flutter, tương thích hoàn toàn với Flutter Web (tự động ánh xạ vào `window.localStorage`).
- **Phương án cân nhắc**: Trực tiếp gọi `dart:html` (bị loại vì làm giảm tính portable và khó viết unit test giả lập).

### Decision 2: Tạo `AuthStorageService` độc lập
- **Giải pháp**: Tạo lớp `AuthStorageService` phụ trách serialize/deserialize `AdminSessionModel` thành chuỗi JSON và lưu vào key `admin_session_data`.
- **Lý do**: Phân tách rõ ràng giữa tầng lưu trữ dữ liệu (Storage) và tầng kết nối mạng (API Service) cũng như tầng giao diện (UI).

### Decision 3: Khôi phục phiên có trạng thái chờ (Session Hydration with Loading State)
- **Giải pháp**: Trong `_WebAdminAppState`, bổ sung cờ `_isCheckingAuth = true` ban đầu. Trong `initState()`, kiểm tra storage:
  1. Nếu không có token -> `_isCheckingAuth = false`, hiển thị `LoginScreen`.
  2. Nếu có token -> gọi `getMe()` với access token.
     - Thành công: nạp `_adminSession`, `_isAuthenticated = true`, `_isCheckingAuth = false` -> Hiển thị Dashboard.
     - Lỗi 401: gọi `refreshToken()` -> nếu thành công, lưu token mới và vào Dashboard; nếu thất bại, xóa storage và về Login.
- **Lý do**: Tránh tình trạng màn hình Login bị giật nháy (flicker) trước khi chuyển vào Dashboard.

## Risks / Trade-offs

- **[Mất kết nối mạng khi reload F5]** → Nếu Backend không thể kết nối khi F5, ứng dụng sẽ không thể xác thực token.
  * *Giảm thiểu*: Bắt ngoại lệ kết nối, giữ lại thông tin hoặc thông báo lỗi rõ ràng kèm tùy chọn thử lại hoặc đăng nhập lại.
- **[Dữ liệu trong LocalStorage bị sửa đổi thủ công]** → Kẻ xấu có thể can thiệp vào chuỗi JSON trong LocalStorage của trình duyệt.
  * *Giảm thiểu*: Mọi token đọc ra đều bắt buộc phải vượt qua bước xác thực chữ ký số từ Backend API `GET /me`. Nếu Backend trả về 401/403, client lập tức xóa sạch LocalStorage.
