# Tasks

## 1. Khởi tạo Module Auth và Khung Giao diện Cơ bản

- [x] 1.1 Khởi tạo thư mục `web-admin/lib/features/auth/presentation/` và tạo widget `LoginScreen` (StatefulWidget). Xác minh file được tạo và import không có lỗi cú pháp.
- [x] 1.2 Xây dựng bố cục toàn trang cho `LoginScreen` bao gồm: nền ứng dụng canvas `#F4F6F8`, thanh chỉ báo bảo mật nội bộ phía trên (môi trường Production, kết nối SSL 256-bit) và chân trang bản quyền quản trị ví. Xác minh bố cục co giãn và căn giữa nội dung đúng quy chuẩn.

## 2. Xây dựng Form Đăng nhập Chuẩn Thiết kế Stitch

- [x] 2.1 Xây dựng thẻ chứa form (Card) trung tâm với độ rộng tối đa 440px, nền trắng `#FFFFFF`, viền `#E2E8F0`, bo góc 16px, đổ bóng nhẹ và cụm logo thương hiệu E-Wallet Admin kèm tiêu đề 'Đăng nhập quản trị'. Xác minh kích thước và typography khớp với Design Tokens (`AppTypography`, `AppDimensions`).
- [x] 2.2 Xây dựng hai trường nhập liệu Tên đăng nhập và Mật khẩu với đầy đủ nhãn trường, dấu bắt buộc `*` màu đỏ, placeholder và tính năng che giấu ký tự mật khẩu (`obscureText: true`). Xác minh hiệu ứng focus viền xanh `#0052CC` kích hoạt khi người dùng nhấp vào ô nhập.
- [x] 2.3 Xây dựng nút bấm Đăng nhập toàn chiều rộng thẻ (full-width), màu nền thương hiệu `#0052CC` (hover `#0040A2`), bo góc 12px và tích hợp vòng quay tiến trình `CircularProgressIndicator` (16px) bên cạnh nhãn nút. Xác minh giao diện nút bấm hiển thị đúng trạng thái ban đầu.
- [x] 2.4 Xây dựng thành phần Alert Banner thông báo trên đầu form và dòng ghi chú tuân thủ tiêu chuẩn an ninh PCI-DSS ở chân form. Xác minh banner hỗ trợ hiển thị cả hai trạng thái lỗi (nền `#FEF2F2`) và thành công (nền `#ECFDF5`).

## 3. Xử lý Trạng thái UI và Mô phỏng Luồng Xác thực

- [x] 3.1 Cài đặt logic kiểm tra tính hợp lệ cơ bản tại client (client-side validation): khi để trống Tên đăng nhập hoặc Mật khẩu, form tự động kích hoạt viền đỏ `border-danger`, hiển thị thông báo lỗi inline dưới ô nhập và mở Alert Banner màu đỏ. Xác minh form chặn quá trình gửi khi dữ liệu không hợp lệ.
- [x] 3.2 Cài đặt trạng thái Loading và mô phỏng phản hồi đăng nhập: khi dữ liệu hợp lệ, khóa tương tác nút Đăng nhập, bật spinner, đổi nhãn thành 'Đang xác thực tài khoản...', chờ 1000ms giả lập và chuyển sang banner xanh thông báo 'Xác thực thành công! Đang chuyển hướng đến Dashboard Quản trị...'. Xác minh hiệu ứng loading và delay hoạt động đúng kịch bản.

## 4. Tích hợp Routing và Điều hướng Demo vào Dashboard

- [x] 4.1 Cập nhật `web-admin/lib/app.dart` bổ sung cờ trạng thái `_isAuthenticated = false`, tích hợp `LoginScreen` làm giao diện khởi đầu và cấu hình tham số callback `onLoginSuccess`. Xác minh ứng dụng khi mở web sẽ hiển thị ngay màn hình Đăng nhập thay vì vào thẳng Dashboard.
- [x] 4.2 Đấu nối sự kiện `onLoginSuccess` trong `app.dart` để cập nhật `_isAuthenticated = true`, chuyển đổi mượt mà sang `AdminShell` chứa `DashboardScreen`. Xác minh sau khi mô phỏng đăng nhập thành công, toàn bộ giao diện Dashboard hiển thị đầy đủ không cần tải lại trang.
- [x] 4.3 Thực hiện kiểm tra tính toàn vẹn và phân tích mã nguồn (`dart analyze` hoặc biên dịch kiểm tra trên `web-admin`) nhằm đảm bảo không có lỗi linter hay xung đột kiểu dữ liệu. Xác minh ứng dụng web-admin sẵn sàng chạy demo ổn định.
