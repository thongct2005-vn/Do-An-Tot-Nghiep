# Design

## Context

Hệ thống quản lý người dùng hiện tại trên Web Admin (`UserListScreen`, `UserDetailDrawer`) đã hỗ trợ xem thông tin cá nhân, hồ sơ định danh KYC và ngân hàng liên kết qua các API tại `backend/src/admin/user/`. Cơ sở dữ liệu PostgreSQL (`ewallet_db.sql`) lưu trữ toàn diện lịch sử giao dịch trong bảng `transactions` cùng các liên kết khóa ngoại tới `users` (`source_user_id`, `destination_user_id`), `linked_bank_accounts` (`linked_bank_account_id`) và `payment_requests` (`order_id`).

Cần thiết kế API `GET /api/v2/admin/user/:id/transactions` và tích hợp hiển thị danh sách giao dịch phân trang ngay trong `UserDetailDrawer` trên Web Admin.

## Goals / Non-Goals

**Goals:**
- Xây dựng endpoint chuẩn RESTful `GET /api/v2/admin/user/:id/transactions` bảo vệ bằng middleware JWT xác thực quyền `ADMIN`.
- Hỗ trợ linh hoạt tham số lọc thời gian: `period` (`day`, `week`, `month`) hoặc khoảng ngày tùy chọn `start_date` & `end_date`.
- Hỗ trợ tìm kiếm từ khóa `keyword` (mã giao dịch, tên đối tác, số điện thoại đối tác, nội dung, tên ngân hàng, mã đơn hàng).
- Phân trang dạng bảng chuẩn Web Admin (`page`, `limit`, `total_items`, `total_pages`).
- Hiển thị đầy đủ số điện thoại đối tác giao dịch (không che mask) để phục vụ nghiệp vụ đối soát và kiểm tra gian lận của Admin.
- Tích hợp mượt mà vào `UserDetailDrawer` trên Flutter Web Admin.

**Non-Goals:**
- Không can thiệp hay sửa đổi trạng thái giao dịch (API chỉ phục vụ tra cứu - Read-only).
- Không chia sẻ dùng chung endpoint với Mobile App để tránh lộ lọt lỗ hổng kiểm soát truy cập (IDOR).

## Decisions

### Quyết định 1: Xây dựng endpoint độc lập cho Admin thay vì tái sử dụng route client
- **Lựa chọn**: Tạo route `GET /api/v2/admin/user/:id/transactions` thuộc module `backend/src/admin/user/`.
- **Lý do**: Endpoint client `GET /api/v2/transaction/history` lấy `userId` từ token phiên đăng nhập của người gọi và che dấu số điện thoại đối tác (`*********123`). Nếu cho phép truyền `userId` vào route client sẽ tạo ra lỗ hổng bảo mật IDOR. Tạo route riêng cho Admin với middleware `requireRole("ADMIN")` vừa đảm bảo an toàn tuyệt đối, vừa cho phép Admin xem đầy đủ dữ liệu gốc.
- **Giải pháp thay thế đã cân nhắc**: Tái sử dụng route client bằng cách thêm cờ phân quyền trong controller của module transaction, nhưng làm phân mảnh logic và tăng nguy cơ lỗi phân quyền.

### Quyết định 2: Gom chung tính năng lọc thời gian vào query params của 1 endpoint duy nhất
- **Lựa chọn**: Sử dụng tham số `period=day|week|month` hoặc `start_date` & `end_date` trong cùng một endpoint `GET /api/v2/admin/user/:id/transactions`.
- **Lý do**: Giúp thiết kế API tinh gọn, phía Web Admin chỉ cần duy nhất một hàm gọi service, dễ dàng chuyển đổi qua lại giữa các nút lọc nhanh (`Hôm nay`, `Tuần này`, `Tháng này`) và bộ chọn khoảng ngày tùy chỉnh.
- **Quy tắc tính toán thời gian trong Service**:
  - `period = 'day'`: Bắt đầu từ `00:00:00` đầu ngày hôm nay đến `23:59:59.999`.
  - `period = 'week'`: Bắt đầu từ `00:00:00` thứ Hai của tuần hiện tại đến `23:59:59.999` Chủ Nhật.
  - `period = 'month'`: Bắt đầu từ `00:00:00` ngày 1 của tháng hiện tại đến `23:59:59.999` ngày cuối tháng.
  - `start_date` & `end_date`: Sử dụng mốc ngày giờ do Admin chỉ định.

### Quyết định 3: Sử dụng phân trang Offset (`page`, `limit`) thay cho Cursor-based
- **Lựa chọn**: Sử dụng `LIMIT` và `OFFSET` kèm câu query `COUNT(*)::INT AS total`.
- **Lý do**: Giao diện Web Admin hiển thị dữ liệu dạng bảng với các nút chuyển trang cụ thể (Trang 1, 2, 3...) và hiển thị tổng số bản ghi (`total_items`), đồng bộ với các màn hình quản trị khác trong `web-admin`.
- **Giải pháp thay thế đã cân nhắc**: Cursor-based (`cursor_id`) như trên Mobile App, tuy nhiên cursor-based chỉ phù hợp cho danh sách cuộn vô tận (infinite scroll) trên điện thoại và không thể nhảy trang tùy ý.

## Risks / Trade-offs

- **[Risk]** Truy vấn đếm `COUNT(*)` và liên kết nhiều bảng có thể chậm nếu tài khoản có lịch sử giao dịch rất lớn.
  - **Mitigation**: Tận dụng các index đã có trong `ewallet_db.sql` gồm `idx_transactions_source_time (source_user_id, created_at DESC)` và `idx_transactions_dest_time (destination_user_id, created_at DESC)`. Giới hạn `limit` tối đa ở mức 50 bản ghi/trang.
- **[Risk]** Người dùng chưa từng phát sinh giao dịch nào hoặc user ID không hợp lệ.
  - **Mitigation**: Service kiểm tra sự tồn tại của người dùng trước qua `adminUserRepository.getUserDetail(userId)`. Nếu không tìm thấy, trả về lỗi 404 chuẩn RESTful; nếu user hợp lệ nhưng chưa có giao dịch, trả về mảng rỗng `items: []` với `total_items: 0`.
