# Tasks

## 1. Khởi tạo Module Quản trị Người dùng (backend/src/admin/user/)

- [x] 1.1 Tạo `backend/src/admin/user/user.repository.js` với các hàm truy vấn database: `getUserStats`, `getUsers`, `getUserDetail`, `updateUserStatus` và kiểm tra cú pháp file bằng lệnh node.
- [x] 1.2 Tạo `backend/src/admin/user/user.service.js` xử lý tính toán phân trang, tìm kiếm, lọc trạng thái, tổng hợp chi tiết và kiểm tra cú pháp file bằng lệnh node.
- [x] 1.3 Tạo `backend/src/admin/user/user.controller.js` tiếp nhận HTTP request, parse query params/path params/body, gọi service và trả về qua `successResponse`, kiểm tra cú pháp file bằng lệnh node.
- [x] 1.4 Tạo `backend/src/admin/user/user.routes.js` khai báo 4 route (`GET /stats`, `GET /`, `GET /:id`, `PATCH /:id/status`) kèm middleware `verifyAccessToken` và `requireRole("ADMIN")`, kiểm tra cú pháp file bằng lệnh node.

## 2. Gắn kết Router và Kiểm thử API Backend

- [x] 2.1 Đăng ký route quản trị người dùng `router.use("/admin/user", adminUserRoutes)` trong `backend/src/routes/index.js` và xác nhận server khởi động không lỗi.
- [x] 2.2 Kiểm thử gọi trực tiếp `GET /api/v2/admin/user/stats` và `GET /api/v2/admin/user` với token Admin để xác nhận trả về dữ liệu người dùng thật từ database.
- [x] 2.3 Kiểm thử gọi `GET /api/v2/admin/user/:id` và `PATCH /api/v2/admin/user/:id/status` để xác nhận xem chi tiết và cập nhật trạng thái người dùng thành công.

## 3. Tích hợp Dữ liệu Thực tế trên Client Web Admin (web-admin)

- [x] 3.1 Bổ sung hằng số URL quản trị người dùng (`adminUserStats`, `adminUsers`, `adminUserDetail`, `adminUserStatus`) trong `web-admin/lib/core/network/api_constants.dart`.
- [x] 3.2 Cập nhật model `UserModel.fromJson` trong `web-admin/lib/features/user/models/user_model.dart` để parse an toàn dữ liệu từ backend response.
- [x] 3.3 Tạo `web-admin/lib/features/user/data/user_api_service.dart` hiện thực các phương thức gọi API có đính kèm Bearer token quản trị viên.
- [x] 3.4 Cập nhật `UserListScreen`, `UserDataTable`, `UserDetailDrawer` và `DeactivateUserDialog` gọi `UserApiService` để hiển thị dữ liệu thật và loại bỏ `MockUsersData`.

## 4. Kiểm thử Hồi quy và Hoàn tất

- [x] 4.1 Viết unit test cho `UserApiService` trong `web-admin/test/user_api_service_test.dart` và chạy `flutter test test/user_api_service_test.dart` đạt 100% pass.
- [x] 4.2 Chạy `flutter test` toàn bộ project `web-admin` và `flutter analyze` đảm bảo 0 lỗi.
