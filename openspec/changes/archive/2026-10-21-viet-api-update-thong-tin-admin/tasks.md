# Tasks

## 1. Hiện thực API Backend (backend/src/admin/user/)

- [x] 1.1 Thêm hàm `updateUserProfile` trong `backend/src/admin/user/user.repository.js` thực hiện cập nhật động các trường `full_name`, `email`, `phone`, `phone_hash` vào bảng `users` với điều kiện `role = 'USER'`, kiểm tra trùng lặp SĐT/Email và trả về dữ liệu sau cập nhật.
- [x] 1.2 Thêm phương thức `updateUserProfile` trong `backend/src/admin/user/user.service.js` xử lý kiểm tra định dạng dữ liệu (SĐT 10 chữ số, email hợp lệ, bắt buộc có lý do), tính toán lại `phone_hash = sha256(phone)`, thu hồi phiên (`refresh_token = NULL`, `fcm_token = NULL`) và kích hoạt `force_logout` qua Socket.io khi SĐT hoặc Email thay đổi.
- [x] 1.3 Thêm handler `updateUserProfile` trong `backend/src/admin/user/user.controller.js` tiếp nhận `:id` từ params, các trường từ body, gọi service và trả về qua `successResponse`.
- [x] 1.4 Khai báo route `router.patch("/:id/profile", adminUserController.updateUserProfile)` trong `backend/src/admin/user/user.routes.js`.
- [x] 1.5 Kiểm tra cú pháp toàn bộ các file backend đã sửa bằng lệnh `node --check`.


## 2. Tích hợp Tầng Mạng và Unit Test trên Web Admin (web-admin/)

- [x] 2.1 Bổ sung hàm tạo endpoint `static String adminUserProfile(String id) => '$baseUrl/admin/user/$id/profile';` trong `web-admin/lib/core/network/api_constants.dart`.
- [x] 2.2 Hiện thực phương thức `updateUserProfile` trong `web-admin/lib/features/user/data/user_api_service.dart` gửi yêu cầu HTTP PATCH kèm Bearer token và parse dữ liệu phản hồi trả về `UserModel`.
- [x] 2.3 Bổ sung các test case cho `updateUserProfile` trong `web-admin/test/user_api_service_test.dart` (test cập nhật thành công 200, test lỗi trùng lặp 409, test lỗi thiếu dữ liệu 400) và chạy `flutter test test/user_api_service_test.dart` đạt 100% pass.


## 3. Xây dựng Giao diện Chỉnh sửa trên Web Admin (web-admin/)

- [x] 3.1 Tạo widget `EditUserProfileDialog` trong `web-admin/lib/features/user/presentation/widgets/edit_user_profile_dialog.dart` hiển thị form nhập Họ tên, SĐT, Email, Lý do chỉnh sửa, hỗ trợ cảnh báo khi tài khoản đã KYC và validate dữ liệu client.
- [x] 3.2 Tích hợp nút icon/button "Chỉnh sửa" vào thẻ Thông tin định danh trong `web-admin/lib/features/user/presentation/widgets/user_detail_drawer.dart` và bổ sung callback `onEditTap`.
- [x] 3.3 Cập nhật `UserListScreen` trong `web-admin/lib/features/user/presentation/user_list_screen.dart` để mở dialog, gọi service cập nhật, cập nhật state của `_selectedUser` và danh sách `_users` tại chỗ và hiển thị thông báo SnackBar.
- [x] 3.4 Chạy `flutter test` và `flutter analyze` trên project `web-admin` đảm bảo 0 lỗi.

