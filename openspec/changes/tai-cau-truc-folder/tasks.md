# Tasks

## 1. Khởi tạo Module Quản trị Xác thực (backend/src/admin/auth/)

- [x] 1.1 Tạo `backend/src/admin/auth/auth.repository.js` chứa các hàm truy vấn database `findAdminByEmail`, `registerFailedLogin`, `resetFailedLogin`, `updateRefreshToken` và kiểm tra cú pháp file bằng lệnh node.
- [x] 1.2 Tạo `backend/src/admin/auth/auth.service.js` hiện thực toàn bộ nghiệp vụ kiểm tra email, mật khẩu bcrypt, vai trò `ADMIN`, trạng thái `ACTIVE`, cơ chế tạm khóa 30 phút sau 5 lần sai, và cấp token JWT (không chứa SĐT).
- [x] 1.3 Tạo `backend/src/admin/auth/auth.controller.js` tiếp nhận request `{ email, password }`, bắt lỗi qua `asyncHandler`, trả về dữ liệu qua `successResponse`, và kiểm tra cú pháp file bằng lệnh node.
- [x] 1.4 Tạo `backend/src/admin/auth/auth.routes.js` gắn middleware giới hạn tần suất `loginLimiter`, khai báo route `POST /login` kết nối controller, và kiểm tra cú pháp file bằng lệnh node.

## 2. Gắn kết Router và Tích hợp Backend

- [x] 2.1 Khai báo và mount `adminAuthRoutes` vào `router.use("/admin/auth", adminAuthRoutes)` trong `backend/src/routes/index.js` và xác nhận server backend khởi động không lỗi.
- [x] 2.2 Kiểm thử gửi request đến `POST /api/v2/admin/auth/login` với tài khoản quản trị hợp lệ, xác nhận nhận mã 200 kèm access token, refresh token và `admin_info` (không chứa trường `phone`).

## 3. Đồng bộ hóa Ứng dụng Web Admin (web-admin)

- [x] 3.1 Cập nhật hằng số URL `adminLogin = '$baseUrl/admin/auth/login'` trong `web-admin/lib/core/network/api_constants.dart`.
- [x] 3.2 Cập nhật unit test trong `web-admin/test/auth_api_service_test.dart` để đối soát khớp với path `/admin/auth/login` và chạy lệnh `flutter test test/auth_api_service_test.dart` đạt 100% pass.
- [x] 3.3 Chạy `flutter analyze` tại thư mục `web-admin` đảm bảo không có cảnh báo hay lỗi cú pháp nào.

## 4. Dọn dẹp Module Người dùng Di động (backend/src/modules/auth/)

- [x] 4.1 Xóa route `POST /admin/login` khỏi `backend/src/modules/auth/auth.routes.js`.
- [x] 4.2 Xóa hàm `adminLogin` khỏi `backend/src/modules/auth/auth.controller.js`.
- [x] 4.3 Xóa các hàm `checkAdminCredentials` và `adminLogin` khỏi `backend/src/modules/auth/auth.service.js`.
- [x] 4.4 Xóa các hàm `resetFailedLoginByEmail` và `registerFailedLoginByEmail` khỏi `backend/src/modules/auth/auth.repository.js`.
- [x] 4.5 Kiểm tra cú pháp toàn bộ module `backend/src/modules/auth/` bằng lệnh node và đảm bảo các export của module User App không bị gãy vỡ.

## 5. Kiểm thử Tích hợp Toàn diện (End-to-End Verification)

- [x] 5.1 Gửi request đến endpoint cũ `POST /api/v2/auth/admin/login` và xác nhận nhận mã lỗi 404 Not Found (đã dọn dẹp triệt để).
- [x] 5.2 Kiểm thử các trường hợp biên trên endpoint mới `POST /api/v2/admin/auth/login`: mật khẩu sai (400), email không tồn tại (404), vai trò không phải ADMIN (403), và tài khoản bị tạm khóa sau 5 lần sai liên tiếp (403).
