# Design

## Context

Màn hình Đăng nhập Quản trị (`LoginScreen`) tại `web-admin/lib/features/auth/presentation/login_screen.dart` đã được xây dựng thành công. Tuy nhiên trong môi trường chạy thực tế trên Flutter Web:
1. `SingleChildScrollView` tự động kích hoạt hiển thị thanh trượt dọc (Scrollbar) màu xám bám sát thẻ card.
2. Form đang hiển thị một khối mô phỏng trạng thái UI (State Switcher) dưới đáy card phục vụ review prototype, gây rối mắt.
3. Ô Tên đăng nhập và Mật khẩu đang bị gán cứng chuỗi demo `'admin_tuan'` và `'••••••••••••'`, làm mất đi tính tự nhiên khi người dùng muốn tự tay nhập tài khoản.

## Goals / Non-Goals

**Goals:**
- Triệt tiêu hoàn toàn thanh cuộn dọc (Scrollbar) trên Flutter Web mà vẫn bảo toàn tính năng cuộn tự nhiên khi màn hình co giãn.
- Gỡ bỏ hoàn toàn thanh điều khiển `_buildStateSwitcher()` và các phương thức liên quan.
- Đặt controller `_usernameController` và `_passwordController` về trạng thái rỗng để hiển thị placeholder và cho phép người dùng tự do nhập.

**Non-Goals:**
- Không thay đổi thiết kế cốt lõi của thẻ đăng nhập (màu sắc, typography, kích thước, hiệu ứng focus/lỗi).
- Không sửa đổi logic điều hướng tại `app.dart`.

## Decisions

### 1. Triệt tiêu Scrollbar bằng ScrollConfiguration
- **Quyết định**: Bọc `SingleChildScrollView` bên trong `ScrollConfiguration` với `behavior: ScrollConfiguration.of(context).copyWith(scrollbars: false)`.
- **Lý do**: Đây là cơ chế chuẩn mực trong Flutter Web để tắt hiển thị thanh cuộn mặc định của trình duyệt mà không làm mất khả năng cuộn của trang khi nội dung vượt quá chiều cao màn hình.
- **Phương án thay thế**: Sử dụng `NeverScrollableScrollPhysics` (sẽ gây lỗi tràn màn hình `RenderFlex overflow` trên các màn hình có chiều cao thấp).

### 2. Dọn dẹp code mô phỏng trạng thái UI
- **Quyết định**: Xóa bỏ hoàn toàn widget `_buildStateSwitcher()`, `_buildChipBtn()` và hàm `_setSimulatedState()`.
- **Lý do**: Trả lại không gian phẳng sạch sẽ cho trang đăng nhập, loại bỏ các thành phần rác không thuộc về giao diện sản phẩm.

### 3. Khởi tạo Controller rỗng
- **Quyết định**: Khởi tạo `TextEditingController()` không truyền tham số `text`.
- **Lý do**: Giúp ô nhập hiển thị đúng placeholder *"Nhập tên đăng nhập"* và *"Nhập mật khẩu"*, cho phép người dùng tự do gõ tài khoản.

## Risks / Trade-offs

- **[Người dùng cuộn trang trên web không thấy thanh trượt]** $\rightarrow$ *Giải pháp*: Chuột lăn (mouse wheel) và thao tác chạm vuốt (touch/trackpad) vẫn hoạt động hoàn hảo; việc ẩn thanh cuộn giúp giao diện đúng chuẩn Web App hiện đại.
