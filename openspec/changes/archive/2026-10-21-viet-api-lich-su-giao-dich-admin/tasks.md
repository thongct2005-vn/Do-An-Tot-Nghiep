# Tasks

## 1. Phát triển Module Backend API (backend/src/admin/user/)

- [x] 1.1 Thêm hàm `getUserTransactions` trong `backend/src/admin/user/user.repository.js` thực hiện truy vấn kết hợp các bảng `transactions`, `users`, `linked_bank_accounts`, `banks`, `payment_requests` kèm bộ lọc `startDate`, `endDate`, `keyword`, `limit`, `offset` và kiểm tra cú pháp file bằng lệnh node.
- [x] 1.2 Bổ sung hàm `getUserTransactions` trong `backend/src/admin/user/user.service.js` kiểm tra user tồn tại, quy đổi `period` (`day`, `week`, `month`) thành khoảng ngày giờ cụ thể, phân loại `direction` (IN/OUT), trích xuất `counterparty_name` và `counterparty_phone` đầy đủ không che mask.
- [x] 1.3 Thêm phương thức `getUserTransactions` trong `backend/src/admin/user/user.controller.js` tiếp nhận params và trả về qua `successResponse`.
- [x] 1.4 Đăng ký endpoint `router.get("/:id/transactions", adminUserController.getUserTransactions)` trong `backend/src/admin/user/user.routes.js` và xác nhận cú pháp file không lỗi.

## 2. Kiểm thử API Backend

- [x] 2.1 Kiểm thử gọi trực tiếp `GET /api/v2/admin/user/:id/transactions` với token Admin để xác nhận trả về danh sách giao dịch từ PostgreSQL và lọc chính xác theo `period=day`, `week`, `month`.
- [x] 2.2 Kiểm thử các trường hợp ngoại lệ: user không tồn tại (trả về lỗi 404) và truy cập không có quyền Admin (trả về lỗi 401/403).

## 3. Tích hợp trên Web Admin (web-admin)

- [x] 3.1 Bổ sung hằng số URL `adminUserTransactions` trong `web-admin/lib/core/network/api_constants.dart`.
- [x] 3.2 Xây dựng model phân tích dữ liệu giao dịch `UserTransactionModel` trong `web-admin/lib/features/user/models/`.
- [x] 3.3 Bổ sung phương thức `getUserTransactions` trong `web-admin/lib/features/user/data/user_api_service.dart` có đính kèm Bearer token Admin.
- [x] 3.4 Cập nhật `UserDetailDrawer` trên `web-admin/lib/features/user/presentation/widgets/user_detail_drawer.dart` để hiển thị khối "Lịch sử giao dịch gần đây", bộ nút lọc thời gian nhanh (`Tất cả`, `Hôm nay`, `Tuần này`, `Tháng này`) và bảng danh sách giao dịch phân trang.

## 4. Kiểm thử Hồi quy và Hoàn tất

- [x] 4.1 Chạy `flutter analyze` trên `web-admin` đảm bảo 0 lỗi.
- [x] 4.2 Chạy `flutter test` toàn bộ project `web-admin` đảm bảo các bài test hiện có vượt qua 100%.
