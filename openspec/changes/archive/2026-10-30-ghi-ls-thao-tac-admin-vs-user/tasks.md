# Tasks: Ghi nhận và truy vấn lịch sử thao tác của Admin đối với tài khoản User

## 1. Tầng Repository (Database Transaction & Queries)

- [x] 1.1 Thêm phương thức `updateUserStatusWithHistory({ client, userId, status, adminId, reason, oldValues, newValues })` trong `backend/src/admin/user/user.repository.js` thực hiện Transaction cập nhật bảng `users` (đồng thời set `refresh_token = NULL`, `fcm_token = NULL` nếu `status = 'BLOCKED'`) và chèn log vào bảng `admin_user_change_history`.
- [x] 1.2 Thêm phương thức `updateUserProfileWithHistory({ client, userId, fullName, phone, phoneHash, email, revokeSession, adminId, reason, oldValues, newValues })` trong `backend/src/admin/user/user.repository.js` thực hiện Transaction cập nhật `users` và chèn log vào `admin_user_change_history`.
- [x] 1.3 Thêm phương thức `getUserChangeHistory({ userId, limit, offset })` trong `backend/src/admin/user/user.repository.js` truy vấn danh sách lịch sử JOIN với bảng `users` để lấy tên/email của Admin và đếm tổng số bản ghi phục vụ phân trang.

## 2. Tầng Service, Controller và Route

- [x] 2.1 Cập nhật `updateUserStatus` trong `backend/src/admin/user/user.service.js` để nhận `adminId`, validate bắt buộc có `reason`, tạo snapshot `old_values`/`new_values`, gọi hàm repository transactional và gửi socket `force_logout` khi tài khoản bị khóa.
- [x] 2.2 Cập nhật `updateUserProfile` trong `backend/src/admin/user/user.service.js` sửa lỗi so sánh tên (`existingUser.name` thành `existingUser.full_name`), nhận `adminId`, tạo snapshot `old_values`/`new_values` và gọi hàm repository transactional.
- [x] 2.3 Thêm phương thức `getUserChangeHistory` trong `backend/src/admin/user/user.service.js` kiểm tra user tồn tại, chuẩn hóa phân trang và định dạng danh sách lịch sử trả về.
- [x] 2.4 Cập nhật `adminUserController` trong `backend/src/admin/user/user.controller.js` trích xuất `adminId = req.user.user_id` truyền xuống service cho `updateUserStatus`, `updateUserProfile` và thêm hàm xử lý cho `getUserChangeHistory`.
- [x] 2.5 Khai báo route `router.get("/:id/history", adminUserController.getUserChangeHistory)` trong `backend/src/admin/user/user.routes.js`.

## 3. Kiểm thử tích hợp & Xác minh (Verification)

- [x] 3.1 Kiểm thử gọi API `PATCH /api/v2/admin/user/:id/status` và xác minh bản ghi `UPDATE_STATUS` được ghi thành công vào bảng `admin_user_change_history` với đầy đủ `admin_id`, `reason`, `old_values` và `new_values`.
- [x] 3.2 Kiểm thử gọi API `PATCH /api/v2/admin/user/:id/profile` và xác minh bản ghi `UPDATE_PROFILE` được ghi thành công với snapshot dữ liệu cũ/mới chính xác.
- [x] 3.3 Kiểm thử gọi API `GET /api/v2/admin/user/:id/history` và xác minh kết quả trả về đúng định dạng danh sách, có tên/email của Admin thực hiện và xử lý phân trang chính xác.
- [x] 3.4 Kiểm thử các trường hợp từ chối: gửi `PATCH /status` không có `reason` nhận mã lỗi `400 Bad Request`, gọi API bằng token không phải `ADMIN` nhận mã lỗi `403 Forbidden`.
