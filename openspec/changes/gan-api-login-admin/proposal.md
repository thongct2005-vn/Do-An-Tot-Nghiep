# Proposal

## Why

Hiện tại màn hình Đăng nhập Quản trị viên (`web-admin/lib/features/auth/presentation/login_screen.dart`) mới chỉ dừng lại ở mức mô phỏng giao diện giả lập (mock auth) với thời gian chờ 1000ms và trường nhập "Tên đăng nhập" chưa đồng bộ với API Backend. Trong khi đó, Backend đã hoàn thiện endpoint xác thực dành riêng cho Quản trị viên (`POST /api/v2/auth/admin/login`) với đầy đủ cơ chế bảo mật (kiểm tra vai trò `ADMIN`, mã hóa mật khẩu bcrypt, đếm sai và tạm khóa 30 phút, cấp JWT Access Token và Refresh Token).

Việc đấu nối API Backend vào giao diện Web Admin lúc này là cần thiết để hoàn thiện chu trình xác thực thật, bảo vệ hệ thống quản trị ví điện tử và cho phép kiểm thử end-to-end với dữ liệu thực tế từ cơ sở dữ liệu (`ewallet_db.sql`).

## What Changes

- **Bổ sung thư viện mạng HTTP**: Thêm `http: ^1.2.0` vào `web-admin/pubspec.yaml` để hỗ trợ gọi REST API từ Flutter Web.
- **Xây dựng tầng dịch vụ kết nối API (API Service & Data Model)**:
  - Tạo `web-admin/lib/core/network/api_constants.dart` cấu hình Base URL (`http://localhost:5000/api/v2`) và các endpoint Auth.
  - Tạo `web-admin/lib/features/auth/models/admin_session_model.dart` chứa cấu trúc `token` (`access_token`, `refresh_token`) và `admin_info` (`user_id`, `email`, `full_name`, `role`).
  - Tạo `web-admin/lib/features/auth/data/auth_api_service.dart` gửi request `POST /api/v2/auth/admin/login`, bóc tách response JSON và chuyển đổi mã lỗi HTTP (`400`, `403`, `404`, `429`) thành thông báo thân thiện.
- **Nâng cấp giao diện Đăng nhập (`LoginScreen`)**:
  - Chuyển đổi trường "Tên đăng nhập" thành "Email quản trị" kèm placeholder `admin@ewallet.com` và quy tắc kiểm tra định dạng email (client-side validation).
  - Thay thế khối logic mô phỏng `Future.delayed` bằng lời gọi API thực tế qua `AuthApiService`.
  - Hiển thị phản hồi lỗi động từ backend lên Alert Banner (mật khẩu sai kèm số lần thử còn lại, tài khoản bị tạm khóa, tài khoản không có quyền Admin, v.v.).
- **Tích hợp quản lý phiên làm việc (`app.dart`)**:
  - Tiếp nhận đối tượng `AdminSessionModel` sau khi đăng nhập thành công.
  - Lưu giữ thông tin phiên quản trị và hỗ trợ chức năng Đăng xuất (Logout) quay về màn hình đăng nhập.
- **Thực thi bộ kịch bản kiểm thử (Test Plan)**:
  - Tiến hành kiểm tra tự động và thủ công theo 8 kịch bản test case với tài khoản thực tế từ CSDL: `admin@ewallet.com` / `123456` (ADMIN), `thongpvt003@gmail.com` (USER), sai mật khẩu, tạm khóa tài khoản.

## Capabilities

### New Capabilities
*(Không có - chức năng nằm trong phạm vi hoàn thiện giao diện đăng nhập quản trị)*

### Modified Capabilities
- `admin-login-ui`: Chuyển đổi từ mô phỏng UI giả lập sang kết nối API backend thực tế `POST /api/v2/auth/admin/login`, nâng cấp trường nhập liệu sang Email quản trị, bắt và hiển thị thông báo lỗi động từ máy chủ, và quản lý phiên đăng nhập của Quản trị viên.

## Impact

- **Phạm vi mã nguồn**:
  - `web-admin/pubspec.yaml`: Bổ sung dependency `http: ^1.2.0`.
  - `web-admin/lib/core/network/api_constants.dart`: Tạo mới.
  - `web-admin/lib/features/auth/models/admin_session_model.dart`: Tạo mới.
  - `web-admin/lib/features/auth/data/auth_api_service.dart`: Tạo mới.
  - `web-admin/lib/features/auth/presentation/login_screen.dart`: Cập nhật logic submit và nhãn trường nhập liệu.
  - `web-admin/lib/app.dart`: Cập nhật callback tiếp nhận thông tin phiên làm việc.
- **Ranh giới an toàn**:
  - Không sửa đổi cấu trúc Backend (`src/modules/auth/` đã hoàn thiện và hoạt động ổn định).
  - Không phá vỡ hệ thống Design Tokens và bố cục giao diện Stitch đã được nghiệm thu trước đó.
