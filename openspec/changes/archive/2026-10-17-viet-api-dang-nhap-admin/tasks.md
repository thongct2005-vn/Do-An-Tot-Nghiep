# Tasks

## 1. Repository Layer

- [x] 1.1 Bổ sung phương thức `resetFailedLoginByEmail(email)` vào `backend/src/modules/auth/auth.repository.js` để đặt lại số lần đăng nhập sai về 0 và xóa thời gian khóa tài khoản.
- [x] 1.2 Bổ sung phương thức `registerFailedLoginByEmail({ email, maxAttempts, lockMinutes })` vào `backend/src/modules/auth/auth.repository.js` để tăng biến đếm số lần đăng nhập sai và tự động cập nhật `locked_until` khi chạm ngưỡng tối đa.

## 2. Service Layer

- [x] 2.1 Viết hàm nội bộ `checkAdminCredentials(email, password)` trong `backend/src/modules/auth/auth.service.js` để xác thực định dạng email, tìm người dùng qua `findUserByEmail`, kiểm tra `status === "ACTIVE"`, `role === "ADMIN"`, kiểm tra `locked_until`, đối chiếu bcrypt mật khẩu và ghi nhận lần thử thất bại.
- [x] 2.2 Bổ sung phương thức `adminLogin({ email, password })` vào đối tượng `authService` trong `backend/src/modules/auth/auth.service.js`, thực hiện ký JWT token với `phone: undefined`, lưu refresh token vào database và trả về `admin_info` đã loại bỏ trường `phone`.

## 3. Controller & Routing Layer

- [x] 3.1 Thêm phương thức `adminLogin(req, res, next)` vào `backend/src/modules/auth/auth.controller.js` để tiếp nhận request body (`email`, `password`), gọi service `adminLogin` và gửi phản hồi thành công qua `successResponse`.
- [x] 3.2 Khai báo endpoint `router.post("/admin/login", loginLimiter, authController.adminLogin);` trong `backend/src/modules/auth/auth.routes.js` để gắn bộ giới hạn tần suất `loginLimiter`.

## 4. Kiểm tra & Xác minh

- [x] 4.1 Kiểm tra cú pháp (Syntax Check) các file đã chỉnh sửa bằng lệnh `node -c` để đảm bảo không có lỗi cú pháp hoặc import/export.
- [x] 4.2 Kiểm tra xác thực các kịch bản thực tế: đăng nhập thành công với tài khoản ADMIN, từ chối khi sai role hoặc sai status, khóa tài khoản sau 5 lần sai liên tiếp, và xác nhận response body cùng JWT payload không để lộ trường `phone`.
