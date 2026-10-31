# Design

## Context

Hệ thống backend hiện đang sử dụng mô hình kiến trúc Controller - Service - Repository phân tách theo từng module (`src/modules/auth`). Luồng đăng nhập của người dùng (`USER`) hiện tại sử dụng quy trình xác thực 2 bước (mật khẩu + OTP điện thoại) và ràng buộc cứng `user.role === 'USER'`.

Xem [proposal.md](proposal.md) để biết bối cảnh và lý do thay đổi. Bản thiết kế này tập trung vào giải pháp kỹ thuật bổ sung API đăng nhập cho Quản trị viên (`ADMIN`) tuân thủ nghiêm ngặt nguyên tắc **chỉ viết thêm (append-only), không sửa đổi code cũ**.

## Goals / Non-Goals

**Goals:**
- Cung cấp endpoint đăng nhập `POST /api/v2/auth/admin/login` hoạt động độc lập và ổn định.
- Xác thực danh tính quản trị viên qua `email` và `password`.
- Kiểm tra nghiêm ngặt điều kiện tài khoản: `user.role === 'ADMIN'` và `user.status === 'ACTIVE'`.
- Triệt tiêu hoàn toàn rò rỉ số điện thoại cá nhân (`phone`) ở cả 2 tầng: HTTP Response body và JWT token payload.
- Phòng vệ chống tấn công dò mật khẩu (Brute-force): 2 tầng gồm IP Rate-Limit (20 req/15 phút) và Account Lockout (khóa 30 phút sau 5 lần sai theo email).
- Không làm ảnh hưởng hay phá vỡ bất kỳ tính năng hiện có nào của hệ thống.

**Non-Goals:**
- Không sửa đổi hay tái cấu trúc các luồng đăng nhập hiện có của `USER` hay `MERCHANT`.
- Không thay đổi cấu trúc bảng `users` trong cơ sở dữ liệu PostgreSQL (các cột cần thiết đều đã có sẵn).
- Không áp dụng xác thực OTP 2 bước qua email/SMS cho Admin ở giai đoạn này (sử dụng đăng nhập 1 bước trực tiếp cấp token cho Web Admin).

## Decisions

### 1. Kiến trúc bổ sung mã nguồn dạng Append-only trong `src/modules/auth`
- **Quyết định**: Bổ sung các hàm độc lập `adminLogin`, `checkAdminCredentials`, `resetFailedLoginByEmail`, `registerFailedLoginByEmail` trực tiếp vào các file tương ứng trong `src/modules/auth`.
- **Lý do**: Tái sử dụng middleware sẵn có (`loginLimiter`, `authMiddleware`), dùng chung tiện ích `tokenUtil`, giữ router `/api/v2/auth` tập trung mà không phát sinh thêm thư mục module cồng kềnh.
- **Phương án thay thế đã xem xét**: Tạo thư mục mới `src/admin/auth/` (tương tự `src/admin/merchant/auth/`). Bị từ chối vì phân mảnh code và không đáp ứng yêu cầu đặt tại `src/modules/auth` của dự án.

### 2. Định danh đăng nhập bằng Email thay vì Số điện thoại
- **Quyết định**: Sử dụng `email` làm trường thông tin đăng nhập chính.
- **Lý do**: Phù hợp với thông lệ quản trị viên doanh nghiệp (dùng email công vụ), tăng cường bảo mật và tách biệt với tài khoản người dùng ví di động.
- **Phương án thay thế đã xem xét**: Đăng nhập bằng SĐT. Bị từ chối do nguy cơ lộ thông tin cá nhân của nhân sự quản trị.

### 3. Kỹ thuật loại bỏ thông tin nhạy cảm (Data Minimization)
- **Quyết định**: 
  - Tại tầng Service: Chỉ map các trường an toàn vào `admin_info` gồm `user_id`, `email`, `full_name`, `role` (loại bỏ `phone`, `balance`, `pin_hash`).
  - Tại tầng JWT Token: Truyền `phone: undefined` vào hàm `tokenUtil.generateAuthTokens`.
- **Lý do**: Khi hàm `jwt.sign` bên trong `jsonwebtoken` tuần tự hóa đối tượng payload, các thuộc tính mang giá trị `undefined` sẽ tự động bị lược bỏ hoàn toàn. Nhờ đó, token payload không chứa trường `phone` mà không cần phải can thiệp hay sửa đổi file dùng chung `src/utils/jwt.js`.

### 4. Giữ nguyên chốt chặn kiểm tra trạng thái hoạt động `user.status === 'ACTIVE'`
- **Quyết định**: Bắt buộc kiểm tra `user.status === 'ACTIVE'` trước khi cho phép đăng nhập.
- **Lý do**: Đảm bảo an toàn vận hành, cho phép vô hiệu hóa quyền truy cập ngay lập tức khi nhân viên nghỉ việc (Offboarding) hoặc tài khoản có dấu hiệu bị chiếm đoạt (Incident Response) mà không cần xóa dữ liệu trong database.

### 5. Cơ chế Brute-Force Lockout độc lập theo Email
- **Quyết định**: Thêm 2 hàm query mới trong `auth.repository.js` thực hiện cập nhật `failed_login_attempts` và `locked_until` dựa trên điều kiện `WHERE email = $1`.
- **Lý do**: Đảm bảo quy trình đếm số lần sai và mở khóa sau 30 phút hoạt động chính xác theo email, hoàn toàn độc lập với trường `phone`.

## Risks / Trade-offs

- **[Tài khoản Admin chưa có Email hoặc trùng lặp Email]** → *Mitigation*: Đảm bảo quy trình cấp phát tài khoản Admin hoặc migration script gán email duy nhất và hợp lệ cho tài khoản quản trị.
- **[Tấn công từ chối dịch vụ (DoS) cố tình nhập sai làm khóa tài khoản Admin]** → *Mitigation*: Tầng bảo vệ IP Rate Limit (`loginLimiter`: 20 requests / 15 phút) sẽ chặn IP của kẻ tấn công trước khi chúng có thể gửi quá nhiều request gây cạn kiệt số lần thử của tài khoản.
