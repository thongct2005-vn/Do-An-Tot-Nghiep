# Design

## Context

Hệ thống quản trị viên hiện tại đã có cơ chế đăng nhập (`POST /admin/auth/login`) sinh ra cặp token gồm `accessToken` (15 phút) và `refreshToken` (7 ngày) được lưu trữ tại cột `refresh_token` của bảng `users`. Đồng thời, hệ thống đã có sẵn các middleware xác thực JWT trong [`backend/src/middlewares/auth.middleware.js`](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/middlewares/auth.middleware.js) gồm `verifyAccessToken`, `verifyRefreshToken`, và `requireRole`.

Tuy nhiên, module [`backend/src/admin/auth`](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/admin/auth) chưa hoàn thiện các tầng Repository, Service, Controller và Routes để xử lý việc gia hạn token, khôi phục phiên và đăng xuất.

## Goals / Non-Goals

**Goals:**
- Cung cấp API `POST /api/v2/admin/auth/refresh-token` cấp lại Access Token và Refresh Token mới (áp dụng Token Rotation).
- Cung cấp API `GET /api/v2/admin/auth/me` để xác thực tính hợp lệ của phiên và lấy thông tin Quản trị viên (loại bỏ trường số điện thoại theo quy định bảo mật).
- Cung cấp API `POST /api/v2/admin/auth/logout` để thu hồi phiên bằng cách xóa `refresh_token` trong cơ sở dữ liệu.
- Đảm bảo tuân thủ kiến trúc 3 tầng chuẩn của dự án: Repository -> Service -> Controller -> Routes.

**Non-Goals:**
- Không thay đổi cấu trúc bảng cơ sở dữ liệu (tận dụng trường `refresh_token` sẵn có).
- Không sửa đổi logic xác thực của các module `user` hay `merchant`.
- Không can thiệp vào mã nguồn Flutter frontend `web-admin` trong phạm vi change này.

## Decisions

### Decision 1: Tái sử dụng các Auth Middleware hiện có
- **Giải pháp**: Tái sử dụng `authMiddleware.verifyRefreshToken` cho route `/refresh-token` và `authMiddleware.verifyAccessToken`, `authMiddleware.requireRole('ADMIN')` cho route `/me` và `/logout`.
- **Lý do**: Middleware hiện có đã xử lý chuẩn hóa các mã lỗi JWT (`401 Token đã hết hạn`, `401 Token không hợp lệ`) và gán thông tin giải mã vào `req.user`.
- **Phương án thay thế cân nhắc**: Viết middleware riêng cho Admin (bị loại vì gây trùng lặp mã nguồn không cần thiết).

### Decision 2: Áp dụng Refresh Token Rotation
- **Giải pháp**: Khi gọi `POST /refresh-token` thành công, hệ thống không chỉ cấp mới `accessToken` mà còn cấp một `refreshToken` mới và lưu ngay vào database.
- **Lý do**: Ngăn chặn tấn công tái sử dụng token (Token Replay Attack). Nếu một Refresh Token bị rò rỉ, nó sẽ trở nên vô giá trị ngay sau lần sử dụng tiếp theo.
- **Phương án thay thế cân nhắc**: Giữ nguyên `refreshToken` cũ đến hết 7 ngày (kém an toàn hơn).

### Decision 3: Cơ chế thu hồi phiên bằng cách set `refresh_token = NULL`
- **Giải pháp**: Khi Admin gọi `POST /logout`, Repository thực thi `UPDATE users SET refresh_token = NULL WHERE id = $1`.
- **Lý do**: Đồng bộ hoàn toàn với cơ chế `revokeSession` đang được áp dụng tại [`user.repository.js`](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/admin/user/user.repository.js#L311-L314).

## Risks / Trade-offs

- **[Nguy cơ request refresh trùng lặp]** → Khi Access Token hết hạn, nhiều request đồng thời từ giao diện có thể cùng kích hoạt refresh token.
  * *Giảm thiểu*: Phía Client cần triển khai hàng đợi (queue) để chỉ gửi 1 request refresh duy nhất, các request còn lại chờ nhận token mới.
- **[Access Token cũ còn hạn tối đa 15 phút sau khi đăng xuất]** → Do JWT là stateless, Access Token cũ vẫn hợp lệ về mặt chữ ký số trong thời gian còn lại của 15 phút.
  * *Giảm thiểu*: Thời gian 15 phút là đủ ngắn theo chuẩn bảo mật ngành. Endpoint `/me` kiểm tra trực tiếp trạng thái `status == 'ACTIVE'` trong database để chặn tài khoản bị khóa.
