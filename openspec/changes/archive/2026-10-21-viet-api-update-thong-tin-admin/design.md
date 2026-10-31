# Design

## Context

Hệ thống hiện tại có module quản lý người dùng tại `backend/src/admin/user/` (bao gồm `user.routes.js`, `user.controller.js`, `user.service.js`, `user.repository.js`) và client Flutter tại `web-admin/lib/features/user/`. Xem `proposal.md` để nắm rõ động lực và bối cảnh nghiệp vụ.

Các ràng buộc kỹ thuật cốt lõi:
- Cột `phone` trong bảng `users` có ràng buộc UNIQUE (`users_phone_key`) và đi kèm `phone_hash` (chuỗi SHA-256 dùng để tra cứu danh bạ không lộ số).
- Cột `email` là kênh nhận mã xác thực OTP phục vụ đăng nhập thiết bị mới và quên mật khẩu.
- Ứng dụng client quản trị Web Admin được xây dựng bằng Flutter Web, giao tiếp qua `UserApiService` có gắn header `Authorization: Bearer <token>`.

## Goals / Non-Goals

**Goals:**
- Cung cấp API `PATCH /api/v2/admin/user/:id/profile` an toàn, xác thực quyền `ADMIN`, kiểm tra xung đột trùng lặp dữ liệu trước khi cập nhật.
- Tự động đồng bộ `phone_hash = sha256(phone)` khi số điện thoại thay đổi.
- Thu hồi phiên đăng nhập cũ (`refresh_token = NULL`, `fcm_token = NULL`) và phát socket `force_logout` khi thông tin đăng nhập/bảo mật (`phone`, `email`) bị thay đổi.
- Xây dựng hộp thoại `EditUserProfileDialog` trên Web Admin hiển thị chuẩn theo Design System của dự án (AppColors, AppTypography, AppDimensions).
- Cập nhật state dữ liệu người dùng tức thì tại `UserDetailDrawer` và `UserDataTable` sau khi cập nhật thành công.

**Non-Goals:**
- Không cho phép chỉnh sửa số dư (`balance`), mật khẩu (`password_hash`), mã PIN (`pin_hash`) hoặc vai trò (`role`).
- Không tạo các bảng hàng chờ phê duyệt hay ticket phức tạp, đảm bảo thao tác trực tiếp của Admin diễn ra tức thì.

## Decisions

### Quyết định 1: Thiết kế 1 Endpoint tổng hợp `PATCH /:id/profile` với cập nhật động (Dynamic Update)
- **Giải pháp**: Xây dựng một endpoint duy nhất tiếp nhận object JSON chứa các trường tùy chọn `{ full_name?, phone?, email?, reason }`. Repository sẽ xây dựng câu lệnh SQL UPDATE động chỉ đối với các trường có giá trị truyền lên.
- **Lý do**: Khớp trực tiếp với hành vi của Form trên giao diện người dùng, giảm thiểu số lượng HTTP request, đảm bảo tính nguyên tử (atomic) trong cơ sở dữ liệu.
- **Phương án thay thế**: Tách thành 3 endpoint riêng lẻ (`PATCH /name`, `PATCH /phone`, `PATCH /email`). Bị loại bỏ vì gây cồng kềnh, khó xử lý đồng bộ khi Admin muốn chỉnh sửa cả SĐT và Email cùng lúc.

### Quyết định 2: Tự động tính toán lại `phone_hash` tại Service layer
- **Giải pháp**: Khi phát hiện trường `phone` được truyền lên và khác số điện thoại hiện tại:
  ```javascript
  const phoneHash = crypto.createHash("sha256").update(phone).digest("hex");
  ```
- **Lý do**: Cột `phone_hash` được hệ thống sử dụng tại API `POST /api/v2/user/check-contact` để người dùng ví khác tra cứu danh bạ. Nếu không cập nhật `phone_hash`, bạn bè của người dùng sẽ không thể tìm thấy số mới để chuyển tiền.
- **Phương án thay thế**: Dùng Trigger trong PostgreSQL. Bị loại bỏ vì logic hashing SHA-256 của Node.js đã chuẩn hóa ở module đăng ký (`auth.service.js`), gom tại tầng Service giúp dễ kiểm thử và nhất quán.

### Quyết định 3: Thu hồi phiên đăng nhập có điều kiện (Conditional Session Invalidation)
- **Giải pháp**:
  - Nếu chỉ sửa `full_name`: Giữ nguyên phiên đăng nhập của người dùng.
  - Nếu sửa `phone` hoặc `email`: Ngay lập tức đặt `refresh_token = NULL`, `fcm_token = NULL`, và gọi hàm `emitToUser(userId, "force_logout", { reason })`.
- **Lý do**: Đổi SĐT hoặc Email là thay đổi kênh định danh đăng nhập và kênh nhận OTP. Việc ngắt phiên ngay lập tức ngăn chặn nguy cơ thiết bị cũ bị kẻ xấu cầm giữ tiếp tục thao tác ví.
- **Phương án thay thế**: Ép đăng xuất trong mọi trường hợp kể cả chỉ sửa họ tên. Bị loại bỏ vì làm giảm trải nghiệm của người dùng không cần thiết khi chỉ sửa lỗi chính tả tên.

### Quyết định 4: Tạo Component Dialog độc lập `EditUserProfileDialog` trên Flutter Web Admin
- **Giải pháp**: Tách riêng widget dialog vào file `edit_user_profile_dialog.dart` kế thừa pattern của `DeactivateUserDialog` đã có trong dự án. Dialog có form validation riêng, quản lý state loading và hiển thị lỗi inline nếu backend trả về lỗi 409 (trùng SĐT/Email).
- **Lý do**: Giúp mã nguồn tách bạch, không làm phình to file `user_detail_drawer.dart` vốn đã hơn 1000 dòng code.

## Risks / Trade-offs

- **[Nguy cơ: Xung đột dữ liệu khi SĐT đã tồn tại]** → Backend thực hiện kiểm tra `SELECT id FROM users WHERE phone = $1 AND id <> $2`, đồng thời bọc trong try/catch bắt mã lỗi PostgreSQL `23505` (`users_phone_key`) để trả về `409 Conflict` kèm thông báo rõ ràng cho Admin.
- **[Nguy cơ: Sửa tên sau khi đã KYC làm lệch CCCD]** → Nếu tài khoản đã hoàn tất KYC (`user_kyc` tồn tại), dialog trên Web Admin sẽ hiển thị icon cảnh báo màu cam và ghi chú rõ cho Admin trước khi bấm lưu.
- **[Đánh đổi: Thiếu bảng lưu vết lịch sử chi tiết]** → Do không tạo migration thêm bảng audit log mới, trường `reason` bắt buộc được gửi kèm trong sự kiện `force_logout` và được in ra log server để phục vụ tra cứu.
