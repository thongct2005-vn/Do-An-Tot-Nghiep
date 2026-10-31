# Design

## Context

Hiện tại, chức năng đăng nhập của Quản trị viên (`adminLogin`) đang nằm trong module `backend/src/modules/auth/` - vốn được thiết kế cho ứng dụng di động của người dùng cuối (User App) với cơ chế xác thực qua Số điện thoại, SMS/Email OTP và mã PIN. Trong khi đó, các chức năng quản trị khác đã bắt đầu được tổ chức trong thư mục `backend/src/admin/` (ví dụ `src/admin/merchant/`).
Xem [proposal.md](file:///d:/KH23_CNTT_HK6_DATN_CODE/openspec/changes/tai-cau-truc-folder/proposal.md) để biết thêm bối cảnh và động lực thay đổi.

## Goals / Non-Goals

**Goals:**
- Tách biệt hoàn toàn mã nguồn xác thực Admin thành module riêng biệt tại `backend/src/admin/auth/` theo mô hình chuẩn 4 lớp (routes, controller, service, repository).
- Cập nhật endpoint chính thức sang `POST /api/v2/admin/auth/login`.
- Gắn router mới vào hệ thống định tuyến tập trung tại `backend/src/routes/index.js`.
- Loại bỏ sạch sẽ các hàm, định tuyến và truy vấn liên quan đến Admin trong `backend/src/modules/auth/` mà không làm ảnh hưởng đến bất kỳ tính năng xác thực nào của User App.
- Đồng bộ hóa cấu hình endpoint trong ứng dụng Flutter Web Admin (`web-admin/lib/core/network/api_constants.dart`) và kịch bản kiểm thử (`web-admin/test/auth_api_service_test.dart`).

**Non-Goals:**
- Không thay đổi nghiệp vụ kiểm tra xác thực (giữ nguyên logic kiểm tra mật khẩu bcrypt, vai trò `ADMIN`, trạng thái `ACTIVE`, khóa tạm 30 phút sau 5 lần sai, và cấp token JWT).
- Không thay đổi bất kỳ hành vi hoặc cấu trúc cơ sở dữ liệu (schema/bảng `users` giữ nguyên).
- Không triển khai các tính năng quản trị mở rộng khác (như CRUD user hay dashboard stats) trong change này.

## Decisions

### 1. Cấu trúc thư mục module `backend/src/admin/auth/`
Tổ chức module quản trị theo cấu trúc tương đồng với kiến trúc hiện có của dự án:
- `auth.routes.js`: Khai báo router Express, áp dụng rate limiter `loginLimiter`, định tuyến `POST /login` đến `authController.login`.
- `auth.controller.js`: Tiếp nhận HTTP request, trích xuất `{ email, password }`, bắt lỗi qua `asyncHandler`, và phản hồi qua `successResponse`.
- `auth.service.js`: Xử lý logic nghiệp vụ đăng nhập Admin:
  - Kiểm tra email tồn tại và định danh tài khoản.
  - Kiểm tra trạng thái tạm khóa (30 phút nếu nhập sai quá 5 lần).
  - So khớp mật khẩu bằng `bcrypt.compare`.
  - Kiểm tra `role === 'ADMIN'` và `status === 'ACTIVE'`.
  - Cập nhật số lần đăng nhập thất bại / reset khi thành công.
  - Cấp cặp JWT `accessToken` & `refreshToken` (payload chứa `user_id`, `role: 'ADMIN'`, tuyệt đối không kèm `phone`).
- `auth.repository.js`: Thao tác truy vấn database `users` qua PostgreSQL pool: `findAdminByEmail`, `registerFailedLogin`, `resetFailedLogin`, `updateRefreshToken`.

*Lựa chọn thay thế đã xem xét:*
- *Giữ nguyên trong `modules/auth/`*: Dẫn đến vi phạm Single Responsibility, khó phân quyền middleware và dễ gây nhầm lẫn khi phát triển tính năng User App.
- *Gộp chung vào một admin controller duy nhất*: Làm phình to file và khó mở rộng khi admin có thêm các chức năng xác thực nâng cao (như 2FA hay SSO).

### 2. Chuẩn hóa Endpoint Định tuyến
- Endpoint mới: `POST /api/v2/admin/auth/login`.
- Router quản trị được mount trong `backend/src/routes/index.js`:
  ```javascript
  const adminAuthRoutes = require("../admin/auth/auth.routes");
  router.use("/admin/auth", adminAuthRoutes);
  ```
- Endpoint cũ `POST /api/v2/auth/admin/login` sẽ được xóa bỏ khỏi `backend/src/modules/auth/auth.routes.js`.

*Lựa chọn thay thế đã xem xét:*
- *Duy trì cả hai endpoint song song (alias)*: Không cần thiết vì hệ thống đang trong giai đoạn phát triển và Web Admin là client duy nhất tiêu thụ API quản trị. Việc cắt bỏ dứt điểm giúp loại bỏ nợ kỹ thuật (technical debt).

### 3. Đồng bộ Client Web Admin
- Cập nhật `web-admin/lib/core/network/api_constants.dart`:
  ```dart
  static const String adminLogin = '$baseUrl/admin/auth/login';
  ```
- Cập nhật unit test trong `web-admin/test/auth_api_service_test.dart` để đối soát đúng URL path `/admin/auth/login`.

## Risks / Trade-offs

- **[Risk] Ảnh hưởng đến luồng xác thực User App khi dọn dẹp `modules/auth/`**  
  → *Mitigation*: Chỉ xóa chính xác các hàm `adminLogin`, `checkAdminCredentials`, `registerFailedLoginByEmail`, `resetFailedLoginByEmail`. Giữ nguyên 100% các hàm xác thực số điện thoại, gửi/xác thực OTP và đăng nhập User.

- **[Risk] Lỗi không đồng bộ phiên bản giữa Backend và Web Admin**  
  → *Mitigation*: Triển khai backend trước hoặc đồng thời với cập nhật client Web Admin; kiểm tra bằng kịch bản test tự động `flutter test` và gọi API trực tiếp.

## Migration Plan

1. Tạo mới 4 files thuộc `backend/src/admin/auth/`.
2. Đăng ký route `/admin/auth` trong `backend/src/routes/index.js`.
3. Kiểm thử endpoint mới `POST /api/v2/admin/auth/login` đảm bảo hoạt động bình thường.
4. Cập nhật `ApiConstants.adminLogin` và unit test trong `web-admin/`.
5. Dọn dẹp các đoạn code thừa trong `backend/src/modules/auth/`.
6. Chạy kiểm thử hồi quy trên cả Backend và Web Admin.
