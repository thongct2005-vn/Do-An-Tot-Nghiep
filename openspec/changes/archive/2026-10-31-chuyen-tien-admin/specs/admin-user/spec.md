# admin-user Spec Delta

## ADDED Requirements

### Requirement: Quản trị viên thực hiện chuyển tiền P2P mô phỏng có kiểm soát
Hệ thống SHALL cung cấp API `POST /api/v2/admin/user/:id/operations/p2p` cho phép Quản trị viên (`ADMIN`) chuyển tiền P2P mô phỏng từ ví `USER A` sang ví `USER B`. Hệ thống MUST xác thực lại `admin_password`, bắt buộc có `reason` và `authorization_reference` hợp lệ, kiểm tra trạng thái `ACTIVE`, hạn mức ngày, số dư và bất biến tổng tiền sau khi giữ khóa `FOR UPDATE`, che SĐT người nhận và phát thông báo sau khi `COMMIT`.

#### Scenario: Quản trị viên chuyển tiền P2P hợp lệ thành công
- **WHEN** Quản trị viên gửi yêu cầu `POST /api/v2/admin/user/:id/operations/p2p` với `Idempotency-Key` hợp lệ, đúng `admin_password`, đầy đủ `destination_user_id`, `amount = 500000`, `reason`, `authorization_reference = "TICKET-2026-00125"`, và cả hai tài khoản `USER A`, `USER B` đều đang `ACTIVE` và đủ số dư/hạn mức
- **THEN** Hệ thống trừ `500.000đ` từ ví `USER A`, cộng `500.000đ` vào ví `USER B` (bảo toàn tổng tiền hai ví), tạo một bản ghi `transactions` với `transaction_type = 'TRANSFER'` và `status = 'SUCCESS'`, ghi một bản ghi `admin_user_change_history` với `action = 'ADMIN_OP_P2P'`, lưu trạng thái `idempotency_keys` trong cùng một transaction, phát thông báo sau `COMMIT` và trả về mã `200 OK` kèm thông tin giao dịch tinh gọn (che số điện thoại người nhận và không lộ số dư người nhận)

#### Scenario: Từ chối khi ví nguồn không đủ số dư
- **WHEN** Quản trị viên gửi yêu cầu chuyển số tiền lớn hơn số dư khả dụng hiện tại của `USER A`
- **THEN** Hệ thống hủy bỏ transaction (`ROLLBACK`), không thay đổi số dư của bất kỳ ví nào, không tạo bản ghi `transactions` hay `admin_user_change_history`, và trả về mã lỗi `422 Unprocessable Entity`

#### Scenario: Từ chối khi vượt quá hạn mức giao dịch trong ngày của ví nguồn
- **WHEN** Tổng giá trị các giao dịch chuyển/rút thành công trong ngày của `USER A` cộng với `amount` yêu cầu vượt quá `50.000.000đ`
- **THEN** Hệ thống hủy bỏ transaction (`ROLLBACK`), không thay đổi số dư và trả về mã lỗi `422 Unprocessable Entity` với thông báo vượt hạn mức ngày

#### Scenario: Từ chối khi ví nguồn hoặc ví đích bị khóa (kể cả vừa bị khóa đồng thời)
- **WHEN** Tài khoản `USER A` hoặc `USER B` đang ở trạng thái `BLOCKED`, hoặc vừa bị một Quản trị viên khác khóa ngay trước thời điểm câu lệnh `SELECT ... FOR UPDATE` trong transaction giành được khóa dòng
- **THEN** Hệ thống phát hiện trạng thái không phải `ACTIVE` ngay sau khi khóa dòng, thực hiện `ROLLBACK` và trả về mã lỗi `403 Forbidden`

#### Scenario: Từ chối khi ví nguồn và ví đích trùng nhau
- **WHEN** Quản trị viên gửi yêu cầu với `destination_user_id` trùng với `:id` (`USER A`)
- **THEN** Hệ thống từ chối yêu cầu và trả về mã lỗi `400 Bad Request`

#### Scenario: Người dùng thường cố gắng gọi API nghiệp vụ Admin
- **WHEN** Một tài khoản có vai trò `USER` gửi yêu cầu đến `POST /api/v2/admin/user/:id/operations/p2p`
- **THEN** Hệ thống từ chối truy cập ngay tại tầng phân quyền và trả về mã lỗi `403 Forbidden`

#### Scenario: Từ chối khi thiếu lý do hoặc thiếu mã tham chiếu ủy quyền
- **WHEN** Quản trị viên gửi yêu cầu nhưng thiếu `reason`, thiếu `authorization_reference`, hoặc `authorization_reference` không đúng định dạng chuẩn (`5-100` ký tự chữ/số/gạch ngang/gạch dưới)
- **THEN** Hệ thống từ chối yêu cầu và trả về mã lỗi `400 Bad Request`

#### Scenario: Từ chối khi Quản trị viên không cung cấp hoặc nhập sai mật khẩu xác nhận
- **WHEN** Quản trị viên gửi yêu cầu nhưng thiếu `admin_password` hoặc `admin_password` không khớp với `password_hash` của Quản trị viên đang đăng nhập
- **THEN** Hệ thống tăng bộ đếm xác thực sai của Admin (khóa tạm nếu vượt ngưỡng), không thực hiện giao dịch và trả về mã lỗi `400 Bad Request` hoặc `401 Unauthorized` / `403 Forbidden`

#### Scenario: Cô lập lỗi Socket và FCM sau khi giao dịch đã COMMIT
- **WHEN** Giao dịch chuyển tiền và ghi lịch sử đã được `COMMIT` thành công trong cơ sở dữ liệu nhưng dịch vụ Socket.io hoặc Firebase Push Notification phát sinh ngoại lệ
- **THEN** Hệ thống chỉ ghi log cảnh báo nội bộ, giữ nguyên kết quả giao dịch đã `COMMIT`, không thực hiện lại giao dịch và vẫn trả về mã `200 OK` cho phía gọi

### Requirement: Kiểm soát chống giao dịch trùng lặp nguyên tử cho nghiệp vụ Admin
Hệ thống SHALL yêu cầu header `Idempotency-Key` cho mọi yêu cầu `POST /api/v2/admin/user/:id/operations/p2p`, lưu đường dẫn chuẩn hóa đầy đủ trong cột `idempotency_keys.request_path` (`VARCHAR(255)`), và tính dấu vân tay `request_hash` (SHA-256) gắn với định danh Admin cùng toàn bộ thông số giao dịch. Hệ thống MUST cập nhật trạng thái `SUCCESS` và `response_body` của `idempotency_keys` trong cùng một Database Transaction với giao dịch chuyển tiền trước khi `COMMIT`.

#### Scenario: Gửi lại cùng Idempotency-Key với cùng nội dung giao dịch
- **WHEN** Quản trị viên gửi lại yêu cầu `POST /api/v2/admin/user/:id/operations/p2p` với cùng `Idempotency-Key` và cùng thông số giao dịch sau khi yêu cầu đầu tiên đã `SUCCESS`
- **THEN** Hệ thống trả về ngay phản hồi `200 OK` đã lưu của giao dịch đầu tiên mà không thực hiện trừ/cộng tiền lần thứ hai

#### Scenario: Gửi lại cùng Idempotency-Key nhưng thay đổi số tiền hoặc người nhận
- **WHEN** Quản trị viên gửi yêu cầu với một `Idempotency-Key` đã tồn tại nhưng thay đổi `amount`, `destination_user_id`, `source_user_id`, `reason` hoặc `authorization_reference`
- **THEN** Hệ thống phát hiện xung đột `request_hash`, từ chối thực hiện và trả về mã lỗi `422 Unprocessable Entity`

#### Scenario: Hai yêu cầu đồng thời sử dụng cùng một Idempotency-Key
- **WHEN** Hai yêu cầu giống hệt nhau có cùng `Idempotency-Key` được gửi đến máy chủ tại cùng một thời điểm
- **THEN** Chỉ một yêu cầu duy nhất giành được quyền thực thi giao dịch chuyển tiền, yêu cầu còn lại nhận mã `409 Conflict` ("Yêu cầu đang được xử lý") hoặc kết quả đã hoàn tất; số dư ví nguồn chỉ bị trừ đúng một lần

## MODIFIED Requirements

### Requirement: Ghi nhận lịch sử kiểm toán thay đổi người dùng
Hệ thống SHALL tự động ghi nhận một bản ghi kiểm toán vào bảng `admin_user_change_history` mỗi khi Quản trị viên thực hiện cập nhật trạng thái, chỉnh sửa thông tin hoặc thực thi nghiệp vụ chuyển tiền P2P trên tài khoản người dùng. Thao tác nghiệp vụ và ghi lịch sử MUST được thực hiện trong cùng một Database Transaction để đảm bảo tính nhất quán dữ liệu. Bản ghi MUST lưu trữ chính xác định danh quản trị viên thực hiện, người dùng bị tác động, hành động (`USER_BLOCKED`, `USER_UNBLOCKED`, `USER_PROFILE_UPDATED`, `ADMIN_OP_P2P`), lý do bắt buộc, cùng dữ liệu trước và sau thay đổi ở định dạng JSONB tinh gọn (không lưu dư thừa số điện thoại đầy đủ của người nhận trong JSONB đối với `ADMIN_OP_P2P`).

#### Scenario: Ghi lịch sử khi thay đổi trạng thái người dùng
- **WHEN** Quản trị viên gửi yêu cầu `PATCH /api/v2/admin/user/:id/status` với trạng thái mới và lý do hợp lệ
- **THEN** Hệ thống cập nhật trạng thái người dùng trong bảng `users`, đồng thời chèn một bản ghi vào bảng `admin_user_change_history` với `action = 'USER_BLOCKED'` hoặc `'USER_UNBLOCKED'`, `reason` tương ứng, `old_values` chứa trạng thái cũ và `new_values` chứa trạng thái mới trong cùng một transaction

#### Scenario: Ghi lịch sử khi cập nhật thông tin cá nhân người dùng
- **WHEN** Quản trị viên gửi yêu cầu `PATCH /api/v2/admin/user/:id/profile` với thông tin thay đổi và lý do hợp lệ
- **THEN** Hệ thống cập nhật thông tin người dùng trong bảng `users`, đồng thời chèn một bản ghi vào bảng `admin_user_change_history` với `action = 'USER_PROFILE_UPDATED'`, `reason` tương ứng, `old_values` chứa snapshot thông tin cũ và `new_values` chứa snapshot thông tin mới trong cùng một transaction

#### Scenario: Ghi lịch sử khi Quản trị viên thực hiện chuyển tiền P2P
- **WHEN** Quản trị viên thực hiện thành công `POST /api/v2/admin/user/:id/operations/p2p`
- **THEN** Hệ thống chèn một bản ghi vào bảng `admin_user_change_history` trong cùng transaction với `action = 'ADMIN_OP_P2P'`, `user_id` là ví nguồn (`USER A`), `old_values` chứa `{"balance_before": ...}` và `new_values` chứa `{"balance_after": ..., "transaction_id": ..., "transaction_type": "TRANSFER", "amount": ..., "fee": 0, "destination_user_id": ..., "authorization_reference": ..., "execution_mode": "SIMULATED_ADMIN_P2P"}`

#### Scenario: Rollback toàn bộ khi quá trình ghi lịch sử gặp lỗi
- **WHEN** Quá trình ghi nhận vào bảng `admin_user_change_history` phát sinh lỗi cơ sở dữ liệu trong bất kỳ thao tác quản trị nào (bao gồm cả chuyển tiền P2P)
- **THEN** Hệ thống MUST hủy bỏ (`ROLLBACK`) toàn bộ giao dịch, không lưu các thay đổi trên bảng `users` hoặc `transactions` và trả về mã lỗi 500 cho phía gọi

#### Scenario: Từ chối thay đổi trạng thái khi thiếu lý do
- **WHEN** Quản trị viên gửi yêu cầu `PATCH /api/v2/admin/user/:id/status` nhưng không cung cấp `reason` hoặc `reason` chỉ chứa khoảng trắng
- **THEN** Hệ thống MUST từ chối xử lý, không thay đổi trạng thái người dùng, không ghi log và trả về mã lỗi `400 Bad Request`

### Requirement: Truy vấn lịch sử thay đổi của người dùng
Hệ thống SHALL cung cấp API cho phép Quản trị viên tra cứu toàn bộ lịch sử các lần thay đổi và nghiệp vụ quản trị liên quan đến một tài khoản người dùng cụ thể. API MUST yêu cầu xác thực bằng Access Token của tài khoản có vai trò `ADMIN`. Đối với nghiệp vụ `ADMIN_OP_P2P`, hệ thống MUST trả về bản ghi lịch sử khi truy vấn từ cả phía ví nguồn (`user_id = :id`) lẫn phía ví đích (`new_values->>'destination_user_id' = :id`). Dữ liệu trả về MUST được sắp xếp theo thời gian mới nhất trước và bao gồm thông tin quản trị viên thực hiện (họ tên, email), loại hành động, vai trò của người dùng trong thao tác, lý do, thời gian thực hiện cùng chi tiết dữ liệu trước và sau thay đổi.

#### Scenario: Quản trị viên lấy danh sách lịch sử thay đổi thành công
- **WHEN** Quản trị viên gửi yêu cầu `GET /api/v2/admin/user/:id/history` với token Admin hợp lệ cho một người dùng tồn tại
- **THEN** Hệ thống trả về mã trạng thái 200 kèm danh sách các bản ghi lịch sử từ bảng `admin_user_change_history` mà người dùng đó là đối tượng trực tiếp hoặc là người nhận trong giao dịch `ADMIN_OP_P2P`

#### Scenario: Tra cứu lịch sử từ phía người nhận USER B của giao dịch Admin P2P
- **WHEN** Quản trị viên gửi yêu cầu `GET /api/v2/admin/user/:userB_id/history` sau khi một giao dịch `ADMIN_OP_P2P` đã chuyển tiền từ `USER A` sang `USER B`
- **THEN** Danh sách lịch sử trả về bao gồm bản ghi `ADMIN_OP_P2P` đó để Quản trị viên nhận biết biến động số dư của `USER B` xuất phát từ thao tác quản trị

#### Scenario: Truy vấn lịch sử của người dùng không tồn tại
- **WHEN** Quản trị viên gửi yêu cầu `GET /api/v2/admin/user/:id/history` với một `id` người dùng không tồn tại trong hệ thống
- **THEN** Hệ thống trả về mã lỗi 404 với thông báo "Không tìm thấy người dùng"

#### Scenario: Người dùng không có quyền quản trị viên cố gắng truy cập lịch sử
- **WHEN** Một tài khoản có vai trò `USER` gửi yêu cầu đến `GET /api/v2/admin/user/:id/history`
- **THEN** Hệ thống từ chối truy cập và trả về mã lỗi 403 Forbidden
