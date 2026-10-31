# Design: Nghiệp vụ Admin chuyển tiền P2P mô phỏng có kiểm soát (chuyen-tien-admin)

## Context

Trong kiến trúc hiện tại của Backend ([transaction.routes.js](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/modules/transaction/transaction.routes.js) và [transaction.repository.js](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/modules/transaction/transaction.repository.js)), luồng chuyển tiền P2P của người dùng (`POST /api/v2/transaction/transfer`) đã có hàm lõi `TransactionRepository.executeTransfer(client, params)` hỗ trợ khóa bi quan hai tài khoản theo thứ tự ID tăng dần (`SELECT ... FOR UPDATE`), trừ/cộng số dư và chèn bản ghi vào bảng `transactions`.

Tuy nhiên, để mở rộng nghiệp vụ cho phép Quản trị viên chuyển tiền P2P hỗ trợ người dùng (`POST /api/v2/admin/user/:id/operations/p2p` — xem `proposal.md` - Why), có 5 khoảng trống kỹ thuật và an toàn cần giải quyết ở cấp kiến trúc:
1. **Kiểm soát nội bộ khi thao tác trên ví người dùng**: Chỉ kiểm tra JWT `ADMIN` và `reason` là chưa đủ; cần bước xác thực lại mật khẩu của chính Admin đang thao tác (`admin_password`) và mã tham chiếu bằng chứng ủy quyền (`authorization_reference`) gắn chặt với nội dung giao dịch.
2. **Giới hạn độ dài cột và lỗ hổng đồng bộ của `idempotency_keys`**: Cột `idempotency_keys.request_path` trong [ewallet_db.sql](file:///d:/KH23_CNTT_HK6_DATN_CODE/ewallet_db.sql#L47) đang là `VARCHAR(50)`, ngắn hơn đường dẫn `/api/v2/admin/user/<uuid>/operations/p2p` (70 ký tự). Đồng thời, middleware [idempotencyKey.js](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/middlewares/idempotencyKey.js) hiện cập nhật trạng thái `SUCCESS` bất đồng bộ trong `res.json` sau khi DB transaction đã đóng, có nguy cơ lệch trạng thái nếu tiến trình gặp sự cố giữa lúc `COMMIT` tiền và lúc trả HTTP response.
3. **Kiểm tra trạng thái và hạn mức sau khi giữ khóa dòng (`FOR UPDATE`)**: `executeTransfer` hiện chỉ truy vấn `id, full_name, phone, balance` mà chưa kiểm tra lại `role = 'USER'`, `status = 'ACTIVE'` và tổng hạn mức giao dịch ngày ngay sau khi khóa dòng.
4. **Tra cứu kiểm toán hai chiều**: Bản ghi `admin_user_change_history` có `user_id = sourceUserId` (`USER A`), nhưng giao dịch đồng thời làm tăng số dư của `USER B` (`destination_user_id`). Cần đảm bảo tra cứu lịch sử từ cả hai phía và tối giản dữ liệu JSONB.
5. **Tinh gọn Response & Cô lập thông báo**: Không trả số dư của `USER B`, che số điện thoại người nhận (`maskPhone`), và cô lập hoàn toàn lỗi Socket/FCM sau `COMMIT`.

## Goals / Non-Goals

**Goals:**
- Tái sử dụng trực tiếp `TransactionRepository.executeTransfer(client, params)` bên trong transaction của `adminUserRepository.executeAdminP2PWithHistory` mà không làm thay đổi hành vi của API Mobile App (`POST /api/v2/transaction/transfer`).
- Thực thi xác thực lại Admin (`admin_password`) và kiểm tra mã ủy quyền (`authorization_reference`) phía máy chủ theo nguyên tắc OWASP Transaction Authorization.
- Đảm bảo tính nguyên tử (ACID) tuyệt đối giữa 4 thao tác trên cùng một kết nối PostgreSQL `client`: **(1) Khóa & kiểm tra trạng thái/hạn mức/bất biến số dư** $\rightarrow$ **(2) Thực thi `executeTransfer`** $\rightarrow$ **(3) Ghi `admin_user_change_history`** $\rightarrow$ **(4) Cập nhật `idempotency_keys.status = 'SUCCESS'` kèm `response_body`** $\rightarrow$ **`COMMIT`**.
- Mở rộng cột `idempotency_keys.request_path` lên `VARCHAR(255)` và thêm expression index cho `admin_user_change_history` để tra cứu hai chiều hiệu năng cao.

**Non-Goals:**
- Không xây dựng hệ thống quy trình phê duyệt đa cấp bất đồng bộ (Maker-Checker nhiều tài khoản Admin) hoặc bảng `admin_operation_requests` riêng trong phạm vi change này (sử dụng mô hình thực thi đồng bộ có xác thực lại Admin và ghi rõ `execution_mode = "SIMULATED_ADMIN_P2P"`).
- Không triển khai các API Nạp tiền (`topup`), Rút tiền (`withdraw`), Thanh toán QR (`qr-payment`) hay Quản lý 2FA trong change này (sẽ tách thành các change tiếp theo).
- Không sửa đổi route hay middleware xác thực PIN của người dùng trên ứng dụng di động.

## Decisions

### 1. Xác thực lại Admin (Step-up Re-authentication) và Ràng buộc Ủy quyền (`authorization_reference`)
- **Lựa chọn**:
  - Yêu cầu request body của `POST /api/v2/admin/user/:id/operations/p2p` cung cấp:
    - `admin_password`: Mật khẩu hiện tại của Admin đang đăng nhập.
    - `authorization_reference`: Mã phiếu hỗ trợ / biên bản ủy quyền hợp lệ (khớp biểu thức chính quy `/^[A-Za-z0-9_-]{5,100}$/`).
    - `reason`: Lý do thực hiện (chuỗi không rỗng, tối đa 500 ký tự).
  - Tại `adminUserService.executeAdminP2P`:
    - Truy vấn thông tin Admin theo `adminId` (từ `req.user.user_id`), kiểm tra `role === 'ADMIN'`, `status === 'ACTIVE'`, và kiểm tra khóa tạm `locked_until`.
    - So khớp `bcrypt.compare(admin_password, admin.password_hash)`. Nếu sai, gọi `adminAuthRepository.registerFailedLogin` để tăng `failed_login_attempts` (khóa tạm 30 phút nếu sai 5 lần) và trả lỗi `401 Unauthorized` (hoặc `403 Forbidden` khi bị khóa).
- **Lý do**: Ngăn chặn rủi ro chiếm quyền phiên làm việc (session hijacking / mở máy tính không khóa màn hình) và đảm bảo mọi giao dịch chuyển tiền hộ người dùng đều gắn với một mã hồ sơ hỗ trợ cụ thể.
- **Phương án thay thế đã cân nhắc**:
  - *Tạo API cấp token xác nhận riêng (2 bước giống PIN token của User)*: Tăng gấp đôi số lượng API cần gọi cho một thao tác đơn lẻ của Admin trong khi truyền trực tiếp `admin_password` kết hợp `Idempotency-Key` và `request_hash` trong cùng request HTTPS đã đạt độ an toàn tương đương và gọn hơn cho đồ án.

### 2. Kiến trúc Idempotency Nguyên tử gắn với Nội dung Giao dịch
- **Lựa chọn**:
  1. **Schema**: Thay đổi `idempotency_keys.request_path` thành `VARCHAR(255)` trong [ewallet_db.sql](file:///d:/KH23_CNTT_HK6_DATN_CODE/ewallet_db.sql).
  2. **Canonical Fingerprint (`request_hash`)**:
     - Lưu `request_path` chuẩn hóa: `"POST /api/v2/admin/user/:id/operations/p2p"`.
     - Tính `request_hash = SHA256(JSON.stringify({ actor_id: String(adminId), operation: "ADMIN_OP_P2P", source_user_id: String(sourceUserId), destination_user_id: String(destinationUserId), amount: Number(amount), description: normalizedDescription, reason: normalizedReason, authorization_reference: normalizedAuthRef }))`.
  3. **Quy trình Giành khóa & Đồng bộ trong Transaction**:
     - Trước khi mở giao dịch chuyển tiền, thực hiện câu lệnh nguyên tử giành quyền xử lý `Idempotency-Key`:
       - Nếu key chưa tồn tại: `INSERT INTO idempotency_keys (idempotency_key, actor_id, actor_type, request_path, request_hash, status) VALUES ($1, $2, 'ADMIN', $3, $4, 'PENDING')`.
       - Nếu key đã tồn tại:
         - Kiểm tra `actor_id`, `request_path` và `request_hash`. Nếu bất kỳ giá trị nào không khớp $\rightarrow$ trả ngay `422 Unprocessable Entity` (*"Mã Idempotency-Key đã được sử dụng với dữ liệu giao dịch khác"*).
         - Nếu khớp hoàn toàn và `status === 'SUCCESS'` $\rightarrow$ trả lại nguyên vẹn `response_body` (`200 OK`) mà không thực thi lại.
         - Nếu `status === 'FAILED'` hoặc `status === 'PENDING'` đã quá hạn treo (`staleSeconds = 60s`) $\rightarrow$ giành lại quyền xử lý bằng `reclaimIdempotencyKey`. Nếu đang `PENDING` trong thời gian hiệu lực (request đồng thời đang chạy) $\rightarrow$ trả ngay `409 Conflict` (*"Yêu cầu đang được xử lý"*).
     - **Bên trong Transaction (`BEGIN ... COMMIT`) của `executeAdminP2PWithHistory`**:
       - Khóa dòng `SELECT status FROM idempotency_keys WHERE idempotency_key = $1 FOR UPDATE` để đảm bảo tuần tự hóa tuyệt đối.
       - Thực thi chuyển tiền và ghi lịch sử `admin_user_change_history`.
       - Cập nhật `UPDATE idempotency_keys SET status = 'SUCCESS', response_status_code = 200, response_body = $1 WHERE idempotency_key = $2` ngay trước `await client.query("COMMIT")`.
       - Nếu xảy ra lỗi và `ROLLBACK`, cập nhật trạng thái key sang `'FAILED'` ở khối `catch` ngoài transaction để cho phép thử lại hợp lệ hoặc trả lỗi tương ứng.
- **Lý do**: Loại bỏ hoàn toàn nguy cơ cắt chuỗi URL làm trùng đường dẫn và triệt tiêu khe hở race condition giữa lúc `COMMIT` giao dịch tiền và lúc lưu kết quả Idempotency.

### 3. Kiểm tra Trạng thái, Hạn mức Ngày và Bất biến Tiền tệ sau `SELECT ... FOR UPDATE`
- **Lựa chọn**:
  - Nâng cấp `TransactionRepository.executeTransfer(client, params)` (hoặc truyền cờ tùy chọn kiểm tra mở rộng tương thích ngược 100% với luồng User):
    1. Khi khóa 2 dòng người dùng theo thứ tự `[firstId, secondId].sort()`:
       ```sql
       SELECT id, role, status, full_name, phone, balance
       FROM users
       WHERE id = $1
       FOR UPDATE
       ```
    2. Ngay sau khi có kết quả `FOR UPDATE`, kiểm tra:
       - `sourceUser.role === 'USER'` và `destUser.role === 'USER'` (nếu không $\rightarrow$ `400 Bad Request`).
       - `sourceUser.status === 'ACTIVE'` (nếu không $\rightarrow$ `403 Forbidden`: *"Tài khoản ví nguồn đang bị khóa"*).
       - `destUser.status === 'ACTIVE'` (nếu không $\rightarrow$ `403 Forbidden`: *"Tài khoản người nhận đang bị khóa"*).
    3. Kiểm tra tổng hạn mức giao dịch trong ngày của `sourceUserId` (`DAILY_TRANSFER_LIMIT = 50_000_000`):
       ```sql
       SELECT COALESCE(SUM(amount + fee), 0)::BIGINT AS daily_used
       FROM transactions
       WHERE source_user_id = $1
         AND transaction_type IN ('TRANSFER', 'WITHDRAW', 'PAYMENT')
         AND status = 'SUCCESS'
         AND created_at >= date_trunc('day', NOW())
       ```
       Nếu `Number(daily_used) + amountNum + feeNum > 50000000` $\rightarrow$ ném lỗi `422 Unprocessable Entity` (*"Vượt quá hạn mức giao dịch trong ngày (50.000.000đ)"*).
    4. Kiểm tra bất biến bảo toàn tổng số dư hai ví trước khi ghi DB:
       ```js
       if (sourceBalanceBefore + destBalanceBefore !== sourceBalanceAfter + destBalanceAfter + feeNum) {
         throw httpError(500, "Lỗi toàn vẹn số dư giao dịch");
       }
       ```
- **Lý do**: Chặn đứng kịch bản một Admin khác vừa khóa tài khoản `USER A` hoặc `USER B` hoặc một giao dịch khác vừa làm vượt hạn mức ngày ngay trước mili-giây lệnh chuyển tiền được thực thi.

### 4. Cấu trúc Audit Log (`admin_user_change_history`) và Truy vấn Hai chiều
- **Lựa chọn**:
  - Chèn vào `admin_user_change_history` trong cùng transaction:
    - `admin_id`: `adminId`
    - `user_id`: `sourceUserId` (`USER A`)
    - `action`: `'ADMIN_OP_P2P'`
    - `reason`: `reason.trim()`
    - `old_values`: `{"balance_before": sourceBalanceBefore}`
    - `new_values`:
      ```json
      {
        "balance_after": 1500000,
        "transaction_id": "100125",
        "transaction_type": "TRANSFER",
        "amount": 500000,
        "fee": 0,
        "destination_user_id": "0196ed40-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "authorization_reference": "TICKET-2026-00125",
        "execution_mode": "SIMULATED_ADMIN_P2P"
      }
      ```
  - Cập nhật `adminUserRepository.getUserChangeHistory({ userId, limit, offset })`:
    ```sql
    WHERE h.user_id = $1
       OR (h.action = 'ADMIN_OP_P2P' AND (h.new_values->>'destination_user_id') = $1::text)
    ```
    Đồng thời bổ sung trường suy diễn `role_in_operation` (`'SOURCE'` nếu `h.user_id = userId`, `'DESTINATION'` nếu người dùng được tra cứu là người nhận trong `ADMIN_OP_P2P`) để hiển thị rõ ràng trên giao diện quản trị.
- **Lý do**: Không lưu trùng lặp thông tin nhạy cảm (`destination_phone`) trong JSONB và đảm bảo khi kiểm toán viên mở hồ sơ của `USER B`, họ thấy rõ khoản tiền nhận vào đến từ thao tác quản trị `ADMIN_OP_P2P`.

## Risks / Trade-offs

- **[Risk: Khóa dòng chờ đợi khi nhiều giao dịch cùng tác động lên một cặp ví]**
  - $\rightarrow$ *Mitigation*: Việc sắp xếp `[firstId, secondId].sort()` trước khi `SELECT ... FOR UPDATE` đảm bảo thứ tự khóa nhất quán trên toàn hệ thống (cả luồng User lẫn luồng Admin), loại bỏ hoàn toàn nguy cơ Deadlock vòng tròn.
- **[Risk: Dịch vụ Socket.io hoặc Firebase FCM bị trễ hoặc lỗi mạng sau khi DB đã COMMIT]**
  - $\rightarrow$ *Mitigation*: Tách biệt hoàn toàn việc phát thông báo ra sau câu lệnh `COMMIT` và sau khi `idempotency_keys` đã được đánh dấu `SUCCESS`. Bọc lời gọi Socket và FCM trong các khối `try/catch` độc lập chỉ ghi log cảnh báo mà không ảnh hưởng đến phản hồi `200 OK`.

## Migration Plan

1. Cập nhật file schema [ewallet_db.sql](file:///d:/KH23_CNTT_HK6_DATN_CODE/ewallet_db.sql):
   - Đồng bộ cột `idempotency_keys.request_path` sang `character varying(255)`.
   - Thêm index `idx_admin_history_p2p_dest_user` trên `admin_user_change_history ((new_values->>'destination_user_id')) WHERE action = 'ADMIN_OP_P2P'`.
2. Cơ sở dữ liệu: Cột `request_path` đã được nâng cấp lên `VARCHAR(255)`; thực thi lệnh `CREATE INDEX IF NOT EXISTS idx_admin_history_p2p_dest_user ON public.admin_user_change_history ((new_values->>'destination_user_id')) WHERE action = 'ADMIN_OP_P2P';` trên cơ sở dữ liệu phát triển.
3. Triển khai code Backend và chạy bộ test tự động kiểm thử 14 kịch bản.

