# Design

## Context

Ứng dụng Flutter Web Admin (`web-admin/`) hiện vận hành theo kiến trúc hiển thị giao diện Client-side Demo (sử dụng dữ liệu tĩnh từ `lib/core/mock/`). Tại [app.dart](file:///d:/KH23_CNTT_HK6_DATN_CODE/web-admin/lib/app.dart), `WebAdminApp` đang khởi chạy trực tiếp vào [AdminShell](file:///d:/KH23_CNTT_HK6_DATN_CODE/web-admin/lib/core/widgets/app_shell.dart) bao bọc `DashboardScreen`.

Nguồn thiết kế màn hình Đăng nhập được bóc tách từ Google Stitch MCP:
- Dự án: **E-Wallet Web Admin** (ID: `9344552715874992654`).
- Màn hình: **Đăng nhập quản trị - E-Wallet Admin** (ID: `56b83be1d522441fbab4804382c8d158`).
- Hệ thống thiết kế: **Fintech Trust Engine** (bảng màu `#0052CC`, font `Inter`, bo góc mềm và viền mỏng `#E2E8F0`).

## Goals / Non-Goals

**Goals:**
- Tạo module mới `web-admin/lib/features/auth/presentation/login_screen.dart` tuân thủ kiến trúc Feature-First.
- Tái hiện chính xác 100% giao diện Stitch: căn giữa, thẻ max-width 440px, logo biểu tượng, tiêu đề, 2 ô nhập liệu Tên đăng nhập và Mật khẩu, nút Đăng nhập tích hợp spinner, chỉ báo an ninh môi trường và PCI-DSS.
- Tái sử dụng toàn diện Design Tokens hiện có (`AppColors`, `AppDimensions`, `AppTypography`, `AppTheme`).
- Quản lý trạng thái nhập liệu (Form validation), trạng thái tải (Loading), trạng thái lỗi và thành công hoàn toàn tại Local Widget State.
- Tích hợp điều hướng mượt mà trong `app.dart` từ màn hình Đăng nhập sang `AdminShell` (chứa `DashboardScreen`) sau khi giả lập đăng nhập thành công.

**Non-Goals:**
- Không gọi HTTP API, không tích hợp Backend, không tạo API client.
- Không lưu token JWT, không lưu session vào LocalStorage hay Cookies.
- Không lưu trữ hoặc so khớp mật khẩu hardcode (chỉ kiểm tra định dạng/rỗng trên UI).
- Không thêm các chức năng: Đăng ký tài khoản, Quên mật khẩu, Xác thực 2 bước (OTP), Đăng nhập một lần (SSO).
- Không chỉnh sửa các màn hình admin hiện có (`dashboard`, `user`, `transaction`).
- Không thêm nút Đăng xuất tại Topbar/Sidebar.

## Decisions

### 1. Kiến trúc thư mục: Feature-First Module
- **Quyết định**: Đặt toàn bộ mã nguồn đăng nhập trong `web-admin/lib/features/auth/presentation/login_screen.dart`.
- **Lý do**: Nhất quán hoàn hảo với cấu trúc của các module hiện tại (`features/dashboard/`, `features/user/`, `features/transaction/`).
- **Phương án thay thế**: Đặt tại `core/widgets/` (sai nguyên tắc phân tách trách nhiệm nghiệp vụ) hoặc đặt ở gốc `lib/login_page.dart` (phá vỡ tính mô-đun).

### 2. Cơ chế Điều hướng (Routing Integration)
- **Quyết định**: Sử dụng cờ trạng thái `bool _isAuthenticated = false` tại `_WebAdminAppState` trong [app.dart](file:///d:/KH23_CNTT_HK6_DATN_CODE/web-admin/lib/app.dart):
  ```
                     +----------------------------------+
                     |         WebAdminApp              |
                     | (_isAuthenticated == false/true) |
                     +----------------------------------+
                                      |
                       +--------------+--------------+
                       |                             |
             [false]   v                   [true]    v
       +-----------------------+           +--------------------+
       |      LoginScreen      |           |     AdminShell     |
       |  (Độc lập toàn trang) |           |  (Sidebar+Topbar)  |
       +-----------------------+           +--------------------+
                   |                                 |
                   v                                 v
          onLoginSuccess()                    DashboardScreen
  ```
- **Lý do**:
  - `AdminShell` bao gồm cố định Sidebar (`260px`) và Topbar (`64px`), trong khi màn hình Đăng nhập là trang độc lập toàn màn hình. Cờ trạng thái giúp phân tách rõ rệt hai ngữ cảnh mà không cần các thư viện routing phức tạp (như `go_router`).
  - Tương thích tuyệt đối với cách `WebAdminApp` đang quản lý chuyển đổi giữa danh sách và chi tiết giao dịch (`_selectedTransaction != null`).
- **Phương án thay thế**: Sử dụng `Navigator.pushReplacement` truyền thống (đòi hỏi lồng thêm `Navigator` hoặc khai báo route tĩnh, gây phức tạp không cần thiết cho demo UI).

### 3. Quản lý trạng thái UI: StatefulWidget nội bộ
- **Quyết định**: Quản lý `_usernameController`, `_passwordController`, `_isLoading`, lỗi validation và alert banner hoàn toàn bên trong `_LoginScreenState`.
- **Lý do**: Phạm vi thay đổi chỉ phục vụ trải nghiệm người dùng trên màn hình đăng nhập, không có dữ liệu cần chia sẻ toàn cục hay lắng nghe từ các module khác.
- **Phương án thay thế**: Bloc, Riverpod hoặc Provider (dư thừa cấu trúc đối với màn hình giao diện demo độc lập).

### 4. Quy trình mô phỏng xác thực (Mock Authentication Flow)
- **Quyết định**:
  1. Khi người dùng bấm "Đăng nhập", form kiểm tra rỗng: nếu thiếu Tên đăng nhập hoặc Mật khẩu $\rightarrow$ cập nhật trạng thái lỗi (viền đỏ, thông báo inline, banner cảnh báo đỏ).
  2. Nếu hợp lệ $\rightarrow$ kích hoạt `_isLoading = true`, vô hiệu hóa nút, hiển thị `CircularProgressIndicator` kích thước 16px và nhãn "Đang xác thực tài khoản...".
  3. Sử dụng `Future.delayed(const Duration(milliseconds: 1000))` để mô phỏng độ trễ mạng thực tế.
  4. Hiển thị banner xanh thông báo: *"Xác thực thành công! Đang chuyển hướng..."*.
  5. Đợi thêm 400ms và gọi `widget.onLoginSuccess()`, kích hoạt `setState(() => _isAuthenticated = true)` tại `app.dart` để mở Dashboard.

## Risks / Trade-offs

- **[Trạng thái phiên làm việc bị đặt lại khi F5 trình duyệt]** $\rightarrow$ *Giải pháp*: Đây là hành vi mong muốn trong chế độ Demo UI. Trong mã nguồn, lập trình viên có thể chuyển đổi giá trị khởi tạo `_isAuthenticated = true/false` khi cần kiểm thử nhanh Dashboard.
- **[Nguy cơ lộ hoặc phụ thuộc thông tin tài khoản]** $\rightarrow$ *Giải pháp*: Form chấp nhận bất kỳ chuỗi ký tự hợp lệ nào (không rỗng), không gán cố định hay kiểm tra mật khẩu cứng trong mã nguồn. Tên đăng nhập mặc định có thể điền sẵn `admin_tuan` để thuận tiện trình chiếu theo đúng mẫu Stitch.
- **[Tràn giao diện trên màn hình độ phân giải thấp]** $\rightarrow$ *Giải pháp*: Khung thẻ đăng nhập được đặt bên trong `SingleChildScrollView` với `ConstrainedBox(maxWidth: 440)` và đệm an toàn, đảm bảo hiển thị hoàn hảo trên mọi kích thước màn hình web.
