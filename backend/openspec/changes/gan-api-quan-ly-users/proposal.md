# Proposal

## Why

Giao diện Quản lý người dùng trên Web Admin (`UserListScreen`, `UserDataTable`, `UserDetailDrawer`, `DeactivateUserDialog`) hiện đang sử dụng dữ liệu tĩnh giả lập (`mock_users_data.dart`). Cần xây dựng module API chuyên trách trong backend tại `backend/src/admin/user/` và tích hợp với client Web Admin để tải, hiển thị, tìm kiếm, phân trang và cập nhật trạng thái người dùng trực tiếp từ cơ sở dữ liệu PostgreSQL thực tế (`users`, `user_kyc`, `linked_bank_accounts`, `banks`).

## What Changes

- **Khởi tạo Module Quản trị Người dùng (`backend/src/admin/user/`)**:
  - `user.repository.js`: Thực hiện truy vấn cơ sở dữ liệu kết hợp bảng `users`, `user_kyc`, `linked_bank_accounts`, `banks` để lấy danh sách người dùng, đếm số lượng, lấy chi tiết người dùng và cập nhật trạng thái.
  - `user.service.js`: Xử lý nghiệp vụ phân trang (`page`, `limit`), tìm kiếm (`search`), lọc theo trạng thái (`status`), thống kê (`stats`) và kiểm tra logic đổi trạng thái người dùng.
  - `user.controller.js`: Tiếp nhận HTTP requests, trích xuất query parameters, path params, request body, xử lý lỗi và trả về phản hồi chuẩn hóa `successResponse`.
  - `user.routes.js`: Khai báo 4 endpoint cốt lõi với middleware bảo vệ `verifyAccessToken` và `requireRole("ADMIN")`.
- **Đăng ký Router Tập trung (`backend/src/routes/index.js`)**:
  - Gắn router mới: `router.use("/admin/user", adminUserRoutes)`.
- **Cung cấp 4 API Endpoint Quản trị**:
  - `GET /api/v2/admin/user/stats`: Thống kê tổng số user, số tài khoản hoạt động (`ACTIVE`), số tài khoản bị khóa (`BLOCKED`).
  - `GET /api/v2/admin/user`: Lấy danh sách người dùng có phân trang, tìm kiếm theo tên/SĐT/email/ID, lọc theo trạng thái.
  - `GET /api/v2/admin/user/:id`: Lấy chi tiết thông tin cá nhân, hồ sơ định danh KYC, và tài khoản ngân hàng liên kết.
  - `PATCH /api/v2/admin/user/:id/status`: Khóa hoặc mở khóa tài khoản người dùng (`ACTIVE` <-> `BLOCKED`).
- **Tích hợp Dữ liệu Thực tế trên Client Web Admin (`web-admin/`)**:
  - Cập nhật hằng số định tuyến API trong `lib/core/network/api_constants.dart`.
  - Tạo service mạng `UserApiService` tại `lib/features/user/data/user_api_service.dart`.
  - Cập nhật model và bộ phân tích dữ liệu JSON (`UserModel.fromJson`).
  - Kết nối dữ liệu thực tế vào `UserListScreen`, `UserDataTable`, `UserDetailDrawer`, `DeactivateUserDialog` để loại bỏ hoàn toàn `MockUsersData`.

## Capabilities

### New Capabilities
*(Không có - chức năng thuộc phạm vi hoàn thiện tính năng quản trị người dùng)*

### Modified Capabilities
- `admin-user`: Mở rộng đặc tả yêu cầu để việc hiển thị danh sách người dùng, thống kê số lượng, tra cứu chi tiết và quy trình vô hiệu hóa tài khoản hoạt động trực tiếp qua REST API kết nối cơ sở dữ liệu PostgreSQL thực tế thay vì mock data cục bộ.

## Impact

- **Phía Backend (`backend/`)**:
  - Thư mục tạo mới: `src/admin/user/` (4 files: `user.routes.js`, `user.controller.js`, `user.service.js`, `user.repository.js`).
  - Tệp chỉnh sửa: `src/routes/index.js` (thêm route mount `/admin/user`).
- **Phía Web Admin (`web-admin/`)**:
  - Tệp tạo mới: `lib/features/user/data/user_api_service.dart`.
  - Tệp chỉnh sửa: `lib/core/network/api_constants.dart`, `lib/features/user/models/user_model.dart`, `lib/features/user/presentation/user_list_screen.dart`.
  - Tệp kiểm thử: Thêm unit test cho `UserApiService`.
