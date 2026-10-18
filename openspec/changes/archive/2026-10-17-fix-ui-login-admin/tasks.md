# Tasks

## 1. Tinh chỉnh Trường Nhập liệu và Bỏ Thanh Mô phỏng UI

- [x] 1.1 Khởi tạo rỗng `_usernameController` và `_passwordController` trong `_LoginScreenState`, loại bỏ các giá trị gán cứng. Xác minh hai ô nhập hiển thị đúng placeholder mờ khi chưa có dữ liệu và cho phép người dùng tự do nhập liệu.
- [x] 1.2 Xóa bỏ hoàn toàn widget `_buildStateSwitcher()`, `_buildChipBtn()` và phương thức `_setSimulatedState()` khỏi `login_screen.dart`. Xác minh vùng bên dưới thẻ đăng nhập được dọn dẹp sạch sẽ, không còn thanh nút mô phỏng.

## 2. Triệt tiêu Thanh Cuộn Dọc và Kiểm tra Toàn diện

- [x] 2.1 Bọc `SingleChildScrollView` trong `ScrollConfiguration` với `behavior: ScrollConfiguration.of(context).copyWith(scrollbars: false)` tại `login_screen.dart`. Xác minh thanh cuộn dọc màu xám trên trình duyệt web được ẩn hoàn toàn.
- [x] 2.2 Thực hiện phân tích mã nguồn (`dart analyze`) cho toàn bộ dự án `web-admin` đảm bảo không có lỗi linter hay cảnh báo cú pháp nào tồn đọng.
