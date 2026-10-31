# Tasks

## 1. Hạ tầng mạng và Cấu trúc Data Model

- [x] 1.1 Bổ sung thư viện `http: ^1.2.0` vào `web-admin/pubspec.yaml` và thực thi lệnh `flutter pub get`. Xác minh thư viện được tải thành công và không xảy ra xung đột dependency.
- [x] 1.2 Tạo file `web-admin/lib/core/network/api_constants.dart` định nghĩa Base URL (`http://localhost:5000/api/v2`) và hằng số endpoint đăng nhập quản trị `/auth/admin/login`. Xác minh file không có lỗi cú pháp.
- [x] 1.3 Tạo file `web-admin/lib/features/auth/models/admin_session_model.dart` định nghĩa lớp dữ liệu ánh xạ `token` (`access_token`, `refresh_token`) và `admin_info` (`user_id`, `email`, `full_name`, `role`). Xác minh hàm `fromJson` phân tích chính xác payload phản hồi từ Backend.

## 2. Xây dựng Dịch vụ Xác thực API Backend

- [x] 2.1 Tạo file `web-admin/lib/features/auth/data/auth_api_service.dart` hiện thực phương thức `login({required String email, required String password})` gửi HTTP POST dạng JSON đến máy chủ. Xác minh hàm xử lý thành công mã 200 và bóc tách chính xác thông báo lỗi từ các mã `400`, `403`, `404`, `429` cùng lỗi mất kết nối mạng.

## 3. Cập nhật Giao diện Đăng nhập và Quản lý Phiên

- [x] 3.1 Cập nhật `web-admin/lib/features/auth/presentation/login_screen.dart`: chuyển đổi controller và nhãn trường nhập liệu từ "Tên đăng nhập" sang "Email quản trị", cập nhật gợi ý placeholder `admin@ewallet.com` và cài đặt hàm kiểm tra định dạng email tại giao diện. Xác minh form chặn gửi và hiển thị viền đỏ cùng thông báo inline khi email sai định dạng.
- [x] 3.2 Tích hợp `AuthApiService` vào phương thức `_handleSubmit()` của `login_screen.dart`, loại bỏ hoàn toàn cơ chế giả lập `Future.delayed`, kích hoạt trạng thái loading trên nút bấm và hiển thị thông báo lỗi động từ Backend lên `AlertBanner`. Xác minh phản hồi lỗi và thành công hiển thị đúng màu sắc và nội dung.
- [x] 3.3 Cập nhật `web-admin/lib/app.dart` để tiếp nhận `AdminSessionModel` thông qua callback `onLoginSuccess(AdminSessionModel session)`, lưu trữ phiên làm việc vào state và hỗ trợ cơ chế đăng xuất quay lại màn hình đăng nhập. Xác minh ứng dụng chuyển tiếp mượt mà vào `AdminShell` (Dashboard).

## 4. Kiểm thử Toàn diện với Dữ liệu CSDL (`ewallet_db.sql`)

- [x] 4.1 Thực hiện kiểm thử kịch bản đăng nhập thành công (TC-01) với tài khoản ADMIN chính thức: `admin@ewallet.com` / `123456`. Xác minh máy chủ trả về mã HTTP 200, giao diện hiển thị banner xanh và chuyển hướng vào Dashboard.
- [x] 4.2 Thực hiện kiểm thử các kịch bản lỗi nghiệp vụ theo dữ liệu CSDL: nhập sai mật khẩu (TC-02: `admin@ewallet.com` / `wrongpass`), kiểm tra thông báo khóa tài khoản (TC-03: sau 5 lần sai), từ chối tài khoản role USER (TC-04: `thongpvt003@gmail.com` / `123456`), và tài khoản không tồn tại (TC-05). Xác minh Alert Banner hiển thị chính xác nội dung thông báo cho từng trường hợp.
- [x] 4.3 Chạy kiểm tra phân tích tĩnh mã nguồn bằng lệnh `flutter analyze` trên thư mục `web-admin`. Xác minh toàn bộ mã nguồn đạt chuẩn linter, không phát sinh cảnh báo hay lỗi kiểu dữ liệu.
