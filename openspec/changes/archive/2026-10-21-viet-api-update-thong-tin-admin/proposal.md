# Proposal

## Why

Hiện tại trên Web Admin, quản trị viên chỉ có thể xem danh sách, xem chi tiết và khóa/mở khóa tài khoản người dùng (`ACTIVE` / `BLOCKED`), nhưng chưa có chức năng cập nhật thông tin người dùng (Họ tên, Số điện thoại, Email). Khi người dùng gặp sự cố như đổi số điện thoại mới, đổi email liên kết hoặc cần hiệu chỉnh họ tên, quản trị viên cần có khả năng cập nhật trực tiếp thông tin người dùng ngay trên giao diện Web Admin mà không phải trải qua các bước phê duyệt trung gian rườm rà, đồng thời vẫn bảo đảm tính an toàn bảo mật cho ví điện tử.

## What Changes

- **Backend**:
  - Bổ sung API `PATCH /api/v2/admin/user/:id/profile` cho phép quản trị viên cập nhật trực tiếp `full_name`, `phone`, `email` của tài khoản người dùng (`role = 'USER'`).
  - Kiểm tra tính hợp lệ và không trùng lặp đối với `phone` và `email`.
  - Tự động tính toán lại `phone_hash = sha256(phone)` khi cập nhật số điện thoại để duy trì tính năng tìm kiếm danh bạ và chuyển tiền.
  - Vô hiệu hóa phiên đăng nhập cũ (`refresh_token = NULL`, `fcm_token = NULL`) và kích hoạt sự kiện Socket.io `force_logout` để ngắt phiên tức thì trên thiết bị người dùng khi SĐT hoặc Email bị thay đổi.
  - Yêu cầu quản trị viên bắt buộc cung cấp lý do chỉnh sửa (`reason`) để lưu vết kiểm toán.
- **Web Admin**:
  - Bổ sung hằng số định tuyến API `adminUserProfile(id)` trong `api_constants.dart`.
  - Bổ sung phương thức `updateUserProfile` trong `UserApiService`.
  - Thêm nút "Chỉnh sửa" tại thẻ Thông tin định danh & bảo mật trong `UserDetailDrawer`.
  - Xây dựng hộp thoại `EditUserProfileDialog` cho phép nhập Họ tên, Số điện thoại, Email và Lý do chỉnh sửa kèm xác thực dữ liệu đầu vào.
  - Tự động cập nhật giao diện `UserDetailDrawer` và `UserDataTable` ngay sau khi cập nhật thành công mà không tải lại toàn trang.

## Capabilities

### New Capabilities
*(Không có)*

### Modified Capabilities
- `admin-user`: Mở rộng đặc tả yêu cầu cho phép Quản trị viên chỉnh sửa trực tiếp thông tin người dùng (Họ tên, Số điện thoại, Email) kèm lý do, bảo vệ phiên đăng nhập và đồng bộ hiển thị tức thì trên Web Admin.

## Impact

- **Mã nguồn Backend (`backend/`)**:
  - `src/admin/user/user.routes.js`: Khai báo route `PATCH /:id/profile`.
  - `src/admin/user/user.controller.js`: Tiếp nhận request, xử lý lỗi và trả về dữ liệu chuẩn qua `successResponse`.
  - `src/admin/user/user.service.js`: Xử lý logic nghiệp vụ validate, kiểm tra trùng lặp, tính toán `phone_hash`, vô hiệu hóa token và phát socket `force_logout`.
  - `src/admin/user/user.repository.js`: Thực hiện cập nhật dữ liệu vào cơ sở dữ liệu PostgreSQL.
- **Mã nguồn Web Admin (`web-admin/`)**:
  - `lib/core/network/api_constants.dart`: Khai báo endpoint URL.
  - `lib/features/user/data/user_api_service.dart`: Phương thức HTTP PATCH gửi Bearer token.
  - `lib/features/user/presentation/widgets/edit_user_profile_dialog.dart`: Dialog form nhập liệu mới.
  - `lib/features/user/presentation/widgets/user_detail_drawer.dart`: Nút chỉnh sửa và tích hợp gọi dialog.
  - `lib/features/user/presentation/user_list_screen.dart`: Xử lý cập nhật state dữ liệu người dùng.
- **Kiểm thử**:
  - Bổ sung unit test cho `UserApiService.updateUserProfile` trong `web-admin/test/user_api_service_test.dart`.
