# Proposal

## Why

Hiện tại, mã nguồn xác thực của Quản trị viên (`adminLogin`) đang bị đặt lẫn lộn bên trong module người dùng di động (`backend/src/modules/auth/`), vốn chuyên trách xác thực bằng Số điện thoại + OTP SMS/Email và mã PIN cho User App. Đồng thời, đường dẫn endpoint `POST /api/v2/auth/admin/login` chưa đồng bộ với quy ước định tuyến quản trị hệ thống (`/api/v2/admin/...`) như `src/admin/merchant/`.

Việc tái cấu trúc bóc tách xác thực Admin thành module độc lập `backend/src/admin/auth/` và chuẩn hóa endpoint thành `POST /api/v2/admin/auth/login` là cần thiết để tuân thủ nguyên lý Single Responsibility, đảm bảo tính đóng gói kiến trúc, tách bạch hoàn toàn luồng quản trị khỏi ứng dụng di động, và đồng bộ giao thức RESTful cho toàn bộ hệ thống Web Admin.

## What Changes

- **Khởi tạo Module Quản trị Xác thực độc lập (`backend/src/admin/auth/`)**:
  - Tạo `auth.routes.js`: Định tuyến endpoint `POST /login` (gắn kèm rate limiter `loginLimiter`).
  - Tạo `auth.controller.js`: Tiếp nhận `{ email, password }` và trả về kết quả chuẩn hóa `successResponse`.
  - Tạo `auth.service.js`: Đảm nhận toàn bộ nghiệp vụ kiểm tra email, đối soát mật khẩu bcrypt, kiểm tra vai trò `ADMIN`, tạm khóa 30 phút khi nhập sai 5 lần, và cấp cặp JWT `accessToken` & `refreshToken`.
  - Tạo `auth.repository.js`: Thực hiện các truy vấn PostgreSQL chuyên biệt: `findAdminByEmail`, `registerFailedLogin`, `resetFailedLogin`, `updateRefreshToken`.
- **Gắn kết Router Quản trị (`backend/src/routes/index.js`)**:
  - Khai báo và mount router: `router.use("/admin/auth", adminAuthRoutes)`.
  - Endpoint chính thức chuyển sang: **`POST /api/v2/admin/auth/login`** (**BREAKING** đối với client gọi endpoint cũ).
- **Dọn dẹp mã nguồn trong `backend/src/modules/auth/`**:
  - Gỡ bỏ định tuyến `router.post("/admin/login")` khỏi `modules/auth/auth.routes.js`.
  - Gỡ bỏ controller `adminLogin` khỏi `modules/auth/auth.controller.js`.
  - Gỡ bỏ `checkAdminCredentials` và `adminLogin` khỏi `modules/auth/auth.service.js`.
  - Gỡ bỏ `resetFailedLoginByEmail` và `registerFailedLoginByEmail` khỏi `modules/auth/auth.repository.js`.
- **Đồng bộ hóa Client Web Admin (`web-admin/`)**:
  - Cập nhật hằng số URL trong `web-admin/lib/core/network/api_constants.dart`: chuyển sang `$baseUrl/admin/auth/login`.
  - Cập nhật kịch bản kiểm thử API trong `web-admin/test/auth_api_service_test.dart` khớp với URL mới.

## Capabilities

### New Capabilities
*(Không có - chức năng thuộc phạm vi chuẩn hóa kiến trúc xác thực quản trị viên)*

### Modified Capabilities
- `admin-auth`: Thay đổi endpoint tiếp nhận yêu cầu đăng nhập từ `POST /api/v2/auth/admin/login` thành `POST /api/v2/admin/auth/login`, đồng thời duy trì toàn bộ nghiệp vụ bảo mật (xác thực email/mật khẩu, kiểm tra vai trò `ADMIN`, tạm khóa 30 phút sau 5 lần sai, cấp cặp token JWT không kèm SĐT).

## Impact

- **Phía Backend (`backend/`)**:
  - Thư mục tạo mới: `src/admin/auth/` (4 files: routes, controller, service, repository).
  - Tệp chỉnh sửa: `src/routes/index.js` (thêm route mount `/admin/auth`).
  - Tệp dọn dẹp: `src/modules/auth/` (loại bỏ mã thừa liên quan đến admin, giữ nguyên 100% tính năng SĐT/OTP của User App).
- **Phía Web Admin (`web-admin/`)**:
  - `lib/core/network/api_constants.dart`: Cập nhật endpoint `adminLogin`.
  - `test/auth_api_service_test.dart`: Cập nhật URL test.
- **Tính tương thích**:
  - Endpoint cũ `POST /api/v2/auth/admin/login` sẽ không còn hoạt động, thay thế hoàn toàn bằng `POST /api/v2/admin/auth/login`.
