# Proposal

## Why

Hiện tại ứng dụng Flutter Web Admin (`web-admin/`) đang mở thẳng vào màn hình Dashboard mà chưa có màn hình đăng nhập độc lập để thể hiện cổng kiểm soát truy cập quản trị. Việc bổ sung màn hình Đăng nhập Quản trị (Admin Login) theo bản vẽ chuẩn từ Google Stitch là cần thiết để hoàn thiện luồng trải nghiệm người dùng (UX demo flow), phục vụ nghiệm thu giao diện đồng bộ với hệ thống thiết kế chung của ví điện tử trước khi đấu nối API xác thực thực tế.

## What Changes

- Bổ sung module giao diện đăng nhập mới (`web-admin/lib/features/auth/`) với màn hình chính `LoginScreen`.
- Hiện thực giao diện tuân thủ chính xác bản vẽ thiết kế từ Google Stitch MCP (Screen: "Đăng nhập quản trị - E-Wallet Admin", Screen ID: `56b83be1d522441fbab4804382c8d158`):
  - Khung đăng nhập trung tâm độ rộng tối đa 440px trên nền canvas xám nhạt (`#F4F6F8`).
  - Trường nhập liệu Tên đăng nhập (Username) và Mật khẩu (Password) có nhãn, dấu bắt buộc `*` và placeholder chuẩn.
  - Nút bấm Đăng nhập chính (`#0052CC`) tích hợp spinner trạng thái loading.
  - Khối chỉ báo môi trường / an ninh trên header và ghi chú tuân thủ PCI-DSS dưới chân form.
- Xử lý kiểm tra dữ liệu nhập (client-side validation) cơ bản trên UI: phát hiện bỏ trống trường và hiển thị thông báo lỗi inline cùng alert banner cảnh báo.
- Hiện thực đầy đủ các trạng thái giao diện: Default, Focus, Validation Error, Loading, Authentication Error và Success.
- Cập nhật cơ chế điều hướng (routing) tại `web-admin/lib/app.dart` bằng cờ trạng thái `_isAuthenticated`: hiển thị `LoginScreen` khi chưa xác thực và chuyển sang `AdminShell` chứa `DashboardScreen` khi đăng nhập demo thành công.
- Tái sử dụng triệt để hệ thống Design Tokens và Widgets hiện có (`AppColors`, `AppDimensions`, `AppTypography`, `AppTheme`).

## Capabilities

### New Capabilities
- `admin-login-ui`: Cung cấp giao diện màn hình Đăng nhập Quản trị viên (Admin Login Screen) trên Flutter Web Admin, bao gồm biểu mẫu nhập liệu, kiểm tra tính hợp lệ cơ bản tại client, mô phỏng các trạng thái UI và điều hướng demo vào Dashboard.

### Modified Capabilities
*(Không có - các capability hiện có giữ nguyên yêu cầu nghiệp vụ)*

## Impact
- **Phạm vi mã nguồn**:
  - Tạo mới thư mục `web-admin/lib/features/auth/` (chỉ chứa UI presentation và local widget state).
  - Cập nhật nhẹ `web-admin/lib/app.dart` để tích hợp chuyển đổi giữa `LoginScreen` và `AdminShell`.
- **Ranh giới an toàn**:
  - Không sửa đổi backend và không thay đổi các module nghiệp vụ admin đã hoàn thiện (`dashboard`, `user`, `transaction`).
  - Không triển khai API client, không lưu token JWT, không lưu mật khẩu.
  - Không phát sinh dependency mới trong `pubspec.yaml`.
