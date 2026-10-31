# Proposal

## Why

Hiện tại hệ thống ví điện tử backend chỉ hỗ trợ luồng đăng nhập cho khách hàng (`USER`) và đối tác (`MERCHANT`). Giao diện quản trị Web Admin đang được xây dựng nhưng chưa có phương thức xác thực dành riêng cho vai trò Quản trị viên (`ADMIN`), khiến quản trị viên không thể đăng nhập lấy token để thao tác. Việc bổ sung API đăng nhập riêng cho Admin qua email và mật khẩu là cấp thiết nhằm bảo đảm an toàn thông tin, bảo vệ dữ liệu cá nhân (không rò rỉ số điện thoại) và cấp quyền truy cập chính xác cho ban quản trị.

## What Changes

- Thêm mới endpoint đăng nhập: `POST /api/v2/auth/admin/login` dành riêng cho vai trò `ADMIN`.
- Xác thực đăng nhập bằng `email` và `password`.
- Kiểm tra tính hợp lệ của tài khoản: trạng thái `status === "ACTIVE"`, vai trò `role === "ADMIN"`, và mật khẩu được mã hóa qua bcrypt.
- Cơ chế bảo vệ Brute-force: Khóa tạm thời 30 phút nếu nhập sai mật khẩu 5 lần liên tiếp dựa trên `email`.
- Cấp cặp JWT Access Token (hạn 15 phút) và Refresh Token (hạn 7 ngày) trực tiếp với type/role là `ADMIN`.
- Bảo mật thông tin (Data Minimization): Loại bỏ hoàn toàn trường số điện thoại (`phone`) khỏi response body và JWT payload của tài khoản Admin.
- Tuân thủ nguyên tắc mở rộng (Append-only): Chỉ viết thêm các hàm và định tuyến mới trong module auth, tuyệt đối không sửa đổi hay ghi đè lên logic đăng nhập của `USER` và `MERCHANT`.

## Capabilities

### New Capabilities
- `admin-auth`: Cung cấp quy trình xác thực danh tính, đăng nhập trực tiếp qua email/mật khẩu và cấp token định danh vai trò Quản trị viên (`ADMIN`).

### Modified Capabilities
<!-- Không có capability hiện có nào bị thay đổi requirements -->

## Impact

- **API Endpoints**: Bổ sung `POST /api/v2/auth/admin/login` vào danh sách API công khai.
- **Backend Code**: Bổ sung hàm mới vào `backend/src/modules/auth/auth.routes.js`, `auth.controller.js`, `auth.service.js`, `auth.repository.js`.
- **Database**: Sử dụng bảng `public.users` sẵn có, truy vấn theo cột `email` và kiểm tra `role = 'ADMIN'`. Không thay đổi cấu trúc bảng (schema DDL).
- **Frontend / Client**: Ứng dụng Web Admin có thể sử dụng endpoint này để xác thực người dùng và lưu trữ JWT token phục vụ các request quản trị tiếp theo.
