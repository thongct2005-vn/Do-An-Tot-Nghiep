# Design: Ghi nhận và truy vấn lịch sử thao tác của Admin đối với tài khoản User

## Context

Bảng `admin_user_change_history` đã được định nghĩa trong cơ sở dữ liệu [ewallet_db.sql](file:///d:/KH23_CNTT_HK6_DATN_CODE/ewallet_db.sql#L6-L17) nhưng chưa từng được gọi trong backend. Hiện tại 2 thao tác quản trị có khả năng thay đổi dữ liệu User (`PATCH /status` và `PATCH /profile`) trong [user.controller.js](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/admin/user/user.controller.js) và [user.service.js](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/admin/user/user.service.js) chỉ thao tác trực tiếp trên bảng `users` mà không lưu vết. Ngoài ra, tham số `adminId` chưa được chuyển tiếp từ `req.user.user_id` xuống service, và chưa có API đọc lịch sử can thiệp của từng người dùng.

## Goals / Non-Goals

**Goals:**
- Tích hợp ghi log kiểm toán tự động, đồng bộ cho 2 thao tác: Đổi trạng thái (`UPDATE_STATUS`) và Đổi thông tin hồ sơ (`UPDATE_PROFILE`).
- Đảm bảo tính toàn vẹn dữ liệu (ACID) qua Database Transaction (`client = await pool.connect()`, `BEGIN` ... `COMMIT` / `ROLLBACK`).
- Cung cấp API `GET /api/v2/admin/user/:id/history` có phân trang, hỗ trợ JOIN để hiển thị đầy đủ tên và email của Quản trị viên đã thực hiện thay đổi.
- Bắt buộc kiểm tra `reason` trước khi thực hiện mọi thao tác ghi/đổi dữ liệu.
- Thu hồi phiên đăng nhập (`refresh_token = NULL`, `fcm_token = NULL`) khi tài khoản bị khóa `BLOCKED`.
- Sửa lỗi so sánh tên tại dòng 318 trong `user.service.js` (`existingUser.name` -> `existingUser.full_name`).

**Non-Goals:**
- Không tạo API cho phép client tự gửi bản ghi lịch sử độc lập (`POST /history`).
- Không sửa đổi schema hay thêm bảng mới vào cơ sở dữ liệu.
- Không triển khai các tính năng mở khóa PIN, 2FA hay mở khóa đăng nhập sai mật khẩu (giữ nguyên phạm vi đã thống nhất).

## Decisions

### 1. Ghi log kiểm toán đồng bộ trong cùng một Database Transaction
- **Lựa chọn**: Sử dụng `const client = await pool.connect()` với `BEGIN`, thực hiện câu lệnh `UPDATE users` và `INSERT INTO admin_user_change_history`, sau đó `COMMIT`.
- **Lý do**: Đây là thao tác kiểm toán tài chính và bảo mật tài khoản. Nếu ghi log thất bại, trạng thái hoặc thông tin người dùng không được phép thay đổi (phải rollback) để tránh tình trạng "thay đổi mà không có dấu vết".
- **Phương án thay thế đã cân nhắc**: 
  - Ghi log bất đồng bộ qua hàng đợi / Outbox pattern: Thừa thãi độ phức tạp cho quy mô hiện tại và có nguy cơ mất mát log nếu worker lỗi.

### 2. Định dạng snapshot `old_values` và `new_values` bằng JSONB
- **Lựa chọn**: Lưu trữ snapshot dạng đối tượng JSON:
  - Với đổi trạng thái:
    - `old_values`: `{"status": existingUser.status}`
    - `new_values`: `{"status": targetStatus}`
  - Với đổi thông tin:
    - `old_values`: `{"full_name": existingUser.full_name, "phone": existingUser.phone, "email": existingUser.email}`
    - `new_values`: `{"full_name": targetFullName || existingUser.full_name, "phone": targetPhone || existingUser.phone, "email": targetEmail !== undefined ? targetEmail : existingUser.email}`
- **Lý do**: Tận dụng cột `jsonb` có sẵn của PostgreSQL, dễ dàng truy vấn và cho phép mở rộng lưu thêm các trường khác trong tương lai mà không phải đổi cấu trúc bảng.

### 3. Trích xuất `adminId` trực tiếp từ Access Token
- **Lựa chọn**: Lấy `adminId = req.user.user_id` từ token đã được giải mã bởi middleware xác thực `verifyAccessToken`.
- **Lý do**: Đảm bảo an ninh tuyệt đối, người dùng hoặc client không thể mạo danh ID của admin khác bằng cách gửi tham số giả trong body hay headers.

### 4. Thiết kế API Đọc lịch sử `GET /api/v2/admin/user/:id/history`
- **Lựa chọn**: 
  - Endpoint: `GET /api/v2/admin/user/:id/history?page=1&limit=10`
  - Truy vấn:
    ```sql
    SELECT 
      h.id,
      h.action,
      h.reason,
      h.old_values,
      h.new_values,
      h.created_at,
      a.id AS admin_id,
      a.full_name AS admin_name,
      a.email AS admin_email
    FROM admin_user_change_history h
    JOIN users a ON h.admin_id = a.id
    WHERE h.user_id = $1
    ORDER BY h.created_at DESC
    LIMIT $2 OFFSET $3;
    ```
- **Lý do**: Trả về trực tiếp tên và email của Quản trị viên để giao diện Web Admin có thể hiển thị trực quan mà không cần gọi thêm API phụ.

## Risks / Trade-offs

- **[Risk: Ràng buộc khóa ngoại `admin_id` thất bại nếu tài khoản admin bị xóa]**
  - $\rightarrow$ *Mitigation*: Khóa ngoại được cấu hình `ON DELETE RESTRICT` trong CSDL; tài khoản Admin không bao giờ bị xóa cứng khỏi hệ thống.
- **[Risk: Không nhất quán giữa phiên đăng nhập thực tế và trạng thái BLOCKED]**
  - $\rightarrow$ *Mitigation*: Khi chuyển trạng thái sang `BLOCKED`, đồng thời đặt `refresh_token = NULL`, `fcm_token = NULL` trong câu lệnh `UPDATE` và bắn socket `force_logout`.
