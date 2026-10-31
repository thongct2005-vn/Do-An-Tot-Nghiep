# Proposal

## Why

Hiện tại trên giao diện Web Admin, khi quản trị viên mở ngăn trượt chi tiết người dùng (`UserDetailDrawer`), hệ thống mới chỉ hiển thị thông tin cá nhân, hồ sơ định danh KYC và tài khoản ngân hàng liên kết mà chưa có tính năng xem lịch sử giao dịch của chính người dùng đó. Quản trị viên không thể tra cứu các giao dịch chuyển tiền, nạp tiền, rút tiền hay thanh toán đơn hàng của người dùng để kịp thời phát hiện gian lận hoặc hỗ trợ giải quyết khiếu nại. Cần cung cấp API chuyên trách `GET /api/v2/admin/user/:id/transactions` kết hợp truy vấn PostgreSQL và tích hợp vào Web Admin.

## What Changes

- **Backend (`backend/src/admin/user/`)**:
  - `user.routes.js`: Đăng ký route mới `GET /api/v2/admin/user/:id/transactions` được bảo vệ bởi middleware `verifyAccessToken` và `requireRole("ADMIN")`.
  - `user.controller.js`: Tiếp nhận HTTP request, trích xuất `id` (userId) từ path param và các query parameters (`period`, `start_date`, `end_date`, `keyword`, `page`, `limit`).
  - `user.service.js`: Xử lý logic nghiệp vụ: kiểm tra user tồn tại, quy đổi `period` (`day`, `week`, `month`) thành khoảng ngày giờ cụ thể (`startDate`, `endDate`), tính toán phân trang `offset`, và chuẩn hóa dữ liệu giao dịch (xác định chiều `direction` IN/OUT, đối tác `counterparty_name`, `counterparty_phone` đầy đủ không che mask, biến động số dư `balance_before`/`balance_after`).
  - `user.repository.js`: Thực hiện truy vấn kết hợp các bảng `transactions`, `users`, `linked_bank_accounts`, `banks`, `payment_requests` trong PostgreSQL, có điều kiện lọc theo user, khoảng thời gian, từ khóa tìm kiếm và hỗ trợ phân trang `LIMIT`/`OFFSET`.
- **Web Admin (`web-admin/`)**:
  - `api_constants.dart`: Khai báo hằng số URL `adminUserTransactions(id)`.
  - `user_api_service.dart`: Bổ sung phương thức `getUserTransactions` gọi API đính kèm Bearer token Admin.
  - `user_detail_drawer.dart`: Thêm phân vùng hoặc tab "Lịch sử giao dịch" với bộ lọc thời gian nhanh (`Tất cả`, `Hôm nay`, `Tuần này`, `Tháng này`), hỗ trợ xem danh sách phân trang và trạng thái thu/chi trực quan.

## Capabilities

### New Capabilities
*(Không có)*

### Modified Capabilities
- `admin-user`: Mở rộng khả năng của Drawer chi tiết người dùng để hiển thị danh sách lịch sử giao dịch của người dùng được chọn, hỗ trợ lọc theo ngày/tuần/tháng hoặc khoảng ngày, tìm kiếm và phân trang trực tiếp từ PostgreSQL.

## Impact

- **Backend (`backend/`)**:
  - Chỉnh sửa 4 tệp trong `src/admin/user/`: `user.routes.js`, `user.controller.js`, `user.service.js`, `user.repository.js`.
  - Không thay đổi cấu trúc bảng cơ sở dữ liệu (tận dụng 100% schema hiện có trong `ewallet_db.sql`).
- **Web Admin (`web-admin/`)**:
  - Chỉnh sửa: `lib/core/network/api_constants.dart`, `lib/features/user/data/user_api_service.dart`, `lib/features/user/presentation/widgets/user_detail_drawer.dart`.
  - Thêm model parsing cho danh sách giao dịch quản trị nếu cần.
