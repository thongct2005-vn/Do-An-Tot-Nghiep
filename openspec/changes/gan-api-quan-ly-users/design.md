# Design

## Context

Giao diện Quản lý người dùng trên Flutter Web Admin (`UserListScreen`, `UserDataTable`, `UserDetailDrawer`, `DeactivateUserDialog`) đã được xây dựng hoàn thiện về mặt thẩm mỹ và bố cục giao diện nhưng hiện vẫn đang tiêu thụ dữ liệu mock từ `MockUsersData.getUsers()`. Trong khi đó, cơ sở dữ liệu PostgreSQL (`ewallet_db.sql`) đã có đầy đủ cấu trúc các bảng `users`, `user_kyc`, `linked_bank_accounts` và `banks`. 
Xem [proposal.md](file:///d:/KH23_CNTT_HK6_DATN_CODE/openspec/changes/gan-api-quan-ly-users/proposal.md) để biết thêm bối cảnh và động lực thay đổi.

## Goals / Non-Goals

**Goals:**
- Xây dựng module backend độc lập `backend/src/admin/user/` tuân thủ mô hình 4 lớp (routes, controller, service, repository).
- Cung cấp 4 endpoint RESTful bảo mật dành riêng cho Quản trị viên:
  1. `GET /api/v2/admin/user/stats`: Thống kê tổng số tài khoản, số tài khoản đang hoạt động (`ACTIVE`), số tài khoản bị khóa (`BLOCKED`).
  2. `GET /api/v2/admin/user`: Truy vấn danh sách người dùng có phân trang (`page`, `limit`), tìm kiếm (`search`), và lọc theo trạng thái (`status`).
  3. `GET /api/v2/admin/user/:id`: Lấy chi tiết hồ sơ người dùng kèm thông tin định danh KYC và danh sách ngân hàng liên kết.
  4. `PATCH /api/v2/admin/user/:id/status`: Cập nhật trạng thái người dùng (`ACTIVE` <-> `BLOCKED`).
- Bảo vệ toàn bộ endpoint bằng middleware `verifyAccessToken` và `requireRole("ADMIN")`.
- Xây dựng `UserApiService` trên Flutter Web Admin và chuyển đổi `UserListScreen` sang tải dữ liệu thực tế từ backend, loại bỏ hoàn toàn mock data.

**Non-Goals:**
- Không hỗ trợ mở khóa thủ công tài khoản bị khóa tạm thời 30 phút do nhập sai mật khẩu (cơ chế này được quản lý tự động bởi thời gian hết hạn `locked_until`).
- Không thay đổi cấu trúc bảng cơ sở dữ liệu (tận dụng nguyên vẹn schema hiện có trong PostgreSQL).
- Không can thiệp vào các API của User App di động (`backend/src/modules/user/`).

## Decisions

### 1. Kiến trúc thư mục và tiền tố định tuyến Backend
- Đặt module tại `backend/src/admin/user/`:
  - `user.routes.js`: Khai báo 4 router, áp dụng `authMiddleware.verifyAccessToken` và `authMiddleware.requireRole("ADMIN")`.
  - `user.controller.js`: Tiếp nhận request, trích xuất parameters, gọi service và phản hồi qua `successResponse`.
  - `user.service.js`: Xử lý tính toán phân trang, định dạng dữ liệu trả về, xử lý đổi trạng thái.
  - `user.repository.js`: Thực hiện các truy vấn PostgreSQL kết hợp bảng `users`, `user_kyc`, `linked_bank_accounts`, `banks`.
- Gắn router trong `backend/src/routes/index.js`:
  ```javascript
  const adminUserRoutes = require("../admin/user/user.routes");
  router.use("/admin/user", adminUserRoutes);
  ```

*Lựa chọn thay thế đã xem xét:*
- *Viết chung vào `modules/user`*: Vi phạm nguyên tắc phân tách trách nhiệm giữa User App và Admin Portal, khó phân quyền middleware.
- *Đặt tên thư mục là `users`*: Không đồng bộ với các thư mục quản trị khác như `src/admin/auth`, `src/admin/merchant`.

### 2. Chiến lược truy vấn dữ liệu SQL (Repository)
- Khi lấy danh sách bảng (`GET /api/v2/admin/user`): Sử dụng `LEFT JOIN` giữa `users`, `user_kyc` và `linked_bank_accounts` (với điều kiện `is_default = true`) để lấy trọn vẹn thông tin Họ tên, SĐT, Email, Số dư, Trạng thái tài khoản, Trạng thái KYC, và Ngân hàng mặc định trong một câu query duy nhất mà không bị lỗi N+1 query.
- Xử lý giá trị mặc định: Dùng `COALESCE(k.status, 'UNVERIFIED')` để đảm bảo những người dùng chưa gửi hồ sơ KYC sẽ hiển thị trạng thái `Chưa định danh`.

### 3. Tích hợp phía Client Web Admin
- `ApiConstants`: Bổ sung các hằng số:
  - `adminUserStats = '$baseUrl/admin/user/stats'`
  - `adminUsers = '$baseUrl/admin/user'`
  - `adminUserDetail(id) = '$baseUrl/admin/user/$id'`
  - `adminUserStatus(id) = '$baseUrl/admin/user/$id/status'`
- `UserApiService`: Tự động đính kèm `Authorization: Bearer <accessToken>` từ session đăng nhập của admin.
- `UserModel.fromJson`: Bổ sung factory constructor để parse chính xác dữ liệu trả về từ backend API (xử lý an toàn các trường null như ngân hàng hoặc KYC).
- `UserListScreen`: Chuyển đổi từ `MockUsersData` sang gọi bất đồng bộ `UserApiService.getUsers()` và `UserApiService.getStats()`.

## Risks / Trade-offs

- **[Risk] Lỗi 401 Unauthorized khi gọi API từ Web Admin**  
  → *Mitigation*: Đảm bảo `UserApiService` lấy token từ storage/session quản trị viên hiện tại; xử lý tự động điều hướng về màn hình login khi token hết hạn.

- **[Risk] Trường dữ liệu KYC hoặc Ngân hàng bị NULL ở một số user mới đăng ký**  
  → *Mitigation*: Sử dụng `LEFT JOIN` và cung cấp fallback an toàn trong SQL (`COALESCE`) cũng như trong Dart (`UserModel.fromJson`).

## Migration Plan

1. Khởi tạo 4 file mã nguồn trong `backend/src/admin/user/`.
2. Đăng ký router `/admin/user` vào `backend/src/routes/index.js`.
3. Kiểm thử trực tiếp 4 endpoint backend qua lệnh curl/node với token admin hợp lệ.
4. Cập nhật `api_constants.dart` và xây dựng `UserApiService` trên `web-admin`.
5. Nối API vào `UserListScreen` và `UserDetailDrawer`, kiểm tra phân trang, tìm kiếm và khóa tài khoản.
6. Chạy `flutter test` và `flutter analyze` để đảm bảo không có lỗi hồi quy.
