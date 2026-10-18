# Proposal

## Why

Màn hình Đăng nhập Quản trị (`LoginScreen`) hiện tại đang hiển thị thanh cuộn dọc (Scrollbar) màu xám đậm ngay cạnh thẻ form do cơ chế mặc định của Flutter Web, đồng thời chứa cụm nút mô phỏng trạng thái UI (State Switcher) và các giá trị tài khoản gán cứng ban đầu. Việc loại bỏ thanh cuộn, gỡ bỏ switcher và để trống các ô nhập liệu là cần thiết để giao diện đạt chuẩn thẩm mỹ phẳng, tối giản và mang lại trải nghiệm nhập liệu tự nhiên, thực tế cho người dùng.

## What Changes

- Ẩn hoàn toàn thanh cuộn dọc (Scrollbar) trên Flutter Web bằng cách bọc vùng cuộn trong `ScrollConfiguration` với `scrollbars: false`.
- Loại bỏ hoàn toàn khối mô phỏng trạng thái UI (`_buildStateSwitcher()`, `_buildChipBtn()` và `_setSimulatedState()`) ở phía dưới thẻ đăng nhập.
- Khởi tạo giá trị mặc định của Tên đăng nhập và Mật khẩu về chuỗi rỗng (`TextEditingController()`), hiển thị placeholder gợi ý rõ ràng và cho phép người dùng tự do nhập liệu thực tế.

## Capabilities

### New Capabilities
- `admin-login-ui`: Tinh chỉnh giao diện màn hình Đăng nhập Quản trị viên trên Flutter Web Admin, đảm bảo không hiển thị thanh cuộn không mong muốn, loại bỏ thanh điều khiển mô phỏng thừa và hỗ trợ trường nhập liệu rỗng thân thiện với người dùng.

### Modified Capabilities
*(Không có)*

## Impact
- **Phạm vi mã nguồn**: Chỉ chỉnh sửa duy nhất file `web-admin/lib/features/auth/presentation/login_screen.dart`.
- **Ranh giới an toàn**: Không ảnh hưởng đến bất kỳ màn hình nào khác, không ảnh hưởng đến routing tại `app.dart` và không thay đổi bất kỳ thành phần nào ngoài `web-admin/`.
