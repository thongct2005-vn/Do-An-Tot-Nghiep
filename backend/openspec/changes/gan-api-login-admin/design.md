# Design

## Context

Xem [proposal.md](proposal.md) để biết động lực và bối cảnh. Hệ thống Flutter Web Admin (`web-admin`) hiện có giao diện đăng nhập hoàn chỉnh về mặt thẩm mỹ theo chuẩn Stitch, nhưng toàn bộ luồng xử lý submit đang sử dụng `Future.delayed` để giả lập. Phía Backend Express (`backend`) đã cung cấp endpoint `POST /api/v2/auth/admin/login` hỗ trợ kiểm tra tài khoản quản trị viên trong PostgreSQL, băm mật khẩu `bcrypt`, giới hạn số lần thử sai qua `failed_login_attempts` và cấp cặp JWT Token (`access_token`, `refresh_token`).

## Goals / Non-Goals

**Goals:**
- Kết nối thành công Flutter Web Admin với endpoint Backend `POST /api/v2/auth/admin/login`.
- Xử lý mượt mà toàn bộ các trường hợp phản hồi từ máy chủ: `200` (thành công), `400` (sai mật khẩu kèm số lần thử còn lại / sai cú pháp), `403` (không có quyền ADMIN / tài khoản bị tạm khóa 30 phút), `404` (tài khoản không tồn tại), `429` (vượt tần suất gửi request).
- Đồng bộ trường nhập liệu: đổi từ "Tên đăng nhập" sang "Email quản trị" kèm kiểm tra định dạng email tại giao diện (client-side validation).
- Quản lý phiên làm việc: lưu trữ token và thông tin quản trị viên vào trạng thái ứng dụng (`app.dart`) để phục vụ các chức năng quản trị sau khi đăng nhập.
- Kiểm thử đầy đủ các test case thực tế với tài khoản quản trị trích xuất từ [ewallet_db.sql](file:///d:/KH23_CNTT_HK6_DATN_CODE/ewallet_db.sql) (`admin@ewallet.com` / `123456`).

**Non-Goals:**
- Không sửa đổi mã nguồn Backend (`src/modules/auth/` giữ nguyên trạng thái hoạt động).
- Không can thiệp vào các màn hình quản trị khác (`DashboardScreen`, `UserListScreen`, `TransactionListScreen`).
- Không triển khai refresh token rotation tự động ngầm dưới background (sẽ là phạm vi của một change riêng khi triển khai các API quản trị dữ liệu sau).

## Decisions

### 1. Sử dụng thư viện `http` cho Flutter Web
- **Lựa chọn**: Thêm `http: ^1.2.0` vào `web-admin/pubspec.yaml`.
- **Lý do**: `http` là thư viện chính thức của Dart/Flutter team, dung lượng nhẹ, tương thích hoàn hảo với môi trường Web (thông qua `fetch` API của trình duyệt bên dưới).
- **Phương án thay thế**: `dio` (quá cồng kềnh đối với chỉ một endpoint đăng nhập ở giai đoạn này) hoặc `dart:html` `HttpRequest` (bị gắn chặt với Web, không đa nền tảng và đang dần bị deprecated).

### 2. Kiến trúc phân tầng Module Auth trên Flutter
- **Cấu trúc thư mục**:
  ```
  web-admin/lib/
  ├── core/
  │   └── network/
  │       └── api_constants.dart          # Cấu hình Base URL và Endpoint
  └── features/auth/
      ├── data/
      │   └── auth_api_service.dart       # Thực thi HTTP request, parse response
      ├── models/
      │   └── admin_session_model.dart    # Token & Admin Info Model
      └── presentation/
          └── login_screen.dart           # Giao diện Form & Controller
  ```
- **Lý do**: Giữ giao diện `login_screen.dart` độc lập với logic mạng, dễ bảo trì, dễ viết unit test và tái sử dụng `AuthApiService`.

### 3. Chuẩn hóa Data Model & Phân loại Ngoại lệ (Exception Handling)
- **Model**: `AdminSessionModel` gồm 2 phần:
  ```dart
  class AdminSessionModel {
    final String accessToken;
    final String refreshToken;
    final AdminInfo adminInfo; // id, email, fullName, role
  }
  ```
- **Xử lý phản hồi Backend**:
  - Khi status code `200`: Trả về `AdminSessionModel`.
  - Khi status code khác `200`: Bóc tách trường `message` từ response JSON của Express (`apiResponse.js`). Nếu có `remainingAttempts`, format hiển thị: `"Mật khẩu không chính xác. Bạn còn X lần thử trước khi tài khoản bị tạm khóa."`
  - Khi gặp lỗi mạng / không thể kết nối: Bắt ngoại lệ và trả về `"Không thể kết nối đến máy chủ quản trị. Vui lòng kiểm tra lại dịch vụ Backend."`

### 4. Nâng cấp trải nghiệm người dùng trên Form Đăng nhập
- Đổi tên `_usernameController` thành `_emailController`.
- Cập nhật nhãn thành `"Email quản trị"`, gợi ý `"admin@ewallet.com"`.
- Bổ sung kiểm tra định dạng email bằng Regex trước khi gọi API để tránh phát sinh request dư thừa.
- Trạng thái nút bấm: Trong lúc request đang gửi, vô hiệu hóa nút, đổi nhãn thành `"Đang xác thực tài khoản..."` và bật spinner.

## Risks / Trade-offs

- **[CORS trên Flutter Web]** → Backend đã cấu hình `app.use(cors())` mở cho mọi domain nên request từ web-admin sẽ không bị chặn CORS.
- **[Backend Server không chạy hoặc lệch cổng]** → Khai báo `api_constants.dart` với URL `http://localhost:5000/api/v2` (hoặc cổng cấu hình). Bắt ngoại lệ `ClientException` để hiển thị banner đỏ rõ ràng thay vì crash ứng dụng.
- **[Xung đột trạng thái phiên làm việc khi F5]** → Tạm thời lưu phiên trong bộ nhớ State của `WebAdminApp`. Đăng xuất sẽ reset `AdminSessionModel` về `null`.
