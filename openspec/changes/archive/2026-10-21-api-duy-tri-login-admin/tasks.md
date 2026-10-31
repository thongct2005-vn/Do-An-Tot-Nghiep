# Tasks

## 1. Tầng Repository (Database Access)

- [x] 1.1 Thêm hàm `findAdminByRefreshToken(refreshToken)` vào `adminAuthRepository` trong `backend/src/admin/auth/auth.repository.js` và kiểm tra truy vấn SQL lọc chính xác user có `role = 'ADMIN'`.
- [x] 1.2 Thêm hàm `findAdminById(adminId)` vào `adminAuthRepository` lấy thông tin Quản trị viên an toàn (không bao gồm `password_hash`, `phone`, `refresh_token`).
- [x] 1.3 Thêm hàm `logout(adminId)` vào `adminAuthRepository` để cập nhật `refresh_token = NULL` cho tài khoản trong cơ sở dữ liệu.

## 2. Tầng Service (Nghiệp vụ xác thực)

- [x] 2.1 Cài đặt phương thức `refreshToken(token)` trong `adminAuthService` (`backend/src/admin/auth/auth.service.js`) thực hiện đối chiếu DB, kiểm tra vai trò `ADMIN` và trạng thái `ACTIVE`, cấp cặp token mới (Token Rotation) và cập nhật DB.
- [x] 2.2 Cài đặt phương thức `getMe(adminId)` trong `adminAuthService` kiểm tra tài khoản tồn tại và trạng thái `ACTIVE`, trả về thông tin cá nhân Quản trị viên an toàn.
- [x] 2.3 Cài đặt phương thức `logout(adminId)` trong `adminAuthService` gọi repository xóa `refresh_token` và kiểm tra xử lý lỗi khi thiếu ID.

## 3. Tầng Controller & Khai báo Routes

- [x] 3.1 Thêm các handlers `refreshToken`, `getMe`, và `logout` vào `adminAuthController` (`backend/src/admin/auth/auth.controller.js`) với format `successResponse` chuẩn.
- [x] 3.2 Khai báo các endpoints trong `backend/src/admin/auth/auth.routes.js`:
  - `POST /refresh-token` sử dụng middleware `authMiddleware.verifyRefreshToken`
  - `GET /me` sử dụng middleware `authMiddleware.verifyAccessToken` và `authMiddleware.requireRole('ADMIN')`
  - `POST /logout` sử dụng middleware `authMiddleware.verifyAccessToken`
- [x] 3.3 Cập nhật các hằng số endpoint trong `web-admin/lib/core/network/api_constants.dart` (`adminRefreshToken`, `adminMe`, `adminLogout`) để chuẩn bị tích hợp frontend.

## 4. Kiểm thử & Đảm bảo chất lượng

- [x] 4.1 Viết kiểm thử tự động (integration test / unit test) cho `POST /admin/auth/refresh-token` bao gồm kịch bản thành công và các kịch bản lỗi (token không khớp, token hết hạn, tài khoản bị khóa).
- [x] 4.2 Viết kiểm thử tự động cho `GET /admin/auth/me` và `POST /admin/auth/logout`, xác minh trường `phone` không xuất hiện trong response và `refresh_token` được xóa khỏi database sau khi đăng xuất.
