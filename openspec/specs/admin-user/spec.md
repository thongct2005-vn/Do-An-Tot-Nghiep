# admin-user Specification

## Purpose

Cung cấp tính năng quản lý danh sách người dùng, tra cứu tài khoản, xem chi tiết thông tin ví qua Drawer và quy trình phê duyệt vô hiệu hóa tài khoản an toàn.

## Requirements

### Requirement: Danh sách và tìm kiếm người dùng
Hệ thống SHALL hiển thị bảng danh sách người dùng bao gồm các trường: Họ tên & Avatar, Số điện thoại ví, Trạng thái KYC, Số dư khả dụng (JetBrains Mono căn phải), Trạng thái tài khoản (Badge: Đang hoạt động / Đã khóa), và Ngày tạo. Trạng thái KYC MUST phản ánh chính xác theo dữ liệu cơ sở dữ liệu: người dùng có trạng thái `APPROVED` hiển thị badge "Đã xác thực", người dùng có trạng thái `null` hoặc không có hồ sơ hiển thị badge "Chưa định danh". Hệ thống MUST cung cấp ô tìm kiếm tại toolbar cho phép lọc danh sách theo Họ tên hoặc Số điện thoại người dùng.

#### Scenario: Hiển thị trạng thái KYC cho tài khoản đã xác thực
- **WHEN** Quản trị viên xem danh sách người dùng và có tài khoản đã hoàn thành KYC với trạng thái `APPROVED` (như Phan Văn Thống)
- **THEN** Cột Trạng thái KYC của tài khoản đó hiển thị badge màu xanh lá với nhãn "Đã xác thực"

#### Scenario: Hiển thị trạng thái KYC cho tài khoản chưa xác thực
- **WHEN** Quản trị viên xem danh sách người dùng và có tài khoản có trạng thái KYC là `null` hoặc chưa nộp hồ sơ KYC
- **THEN** Cột Trạng thái KYC của tài khoản đó hiển thị badge màu đỏ với nhãn "Chưa định danh"

#### Scenario: Tìm kiếm người dùng theo số điện thoại
- **WHEN** Quản trị viên nhập số điện thoại "0901234567" vào ô tìm kiếm
- **THEN** Bảng danh sách người dùng chỉ hiển thị những bản ghi có số điện thoại hoặc họ tên khớp với chuỗi tìm kiếm

### Requirement: Drawer hiển thị chi tiết người dùng tại chỗ
Hệ thống SHALL mở một ngăn trượt chi tiết (Slide-over Drawer) có chiều rộng 480px từ mép phải màn hình khi quản trị viên nhấp vào một dòng người dùng trong danh sách. Quá trình mở Drawer MUST diễn ra ngay tại màn hình danh sách mà không chuyển hướng trang. Drawer MUST hiển thị thông tin trung thực từ cơ sở dữ liệu bao gồm định danh KYC, thẻ số dư ví cá nhân, tài khoản ngân hàng liên kết thực tế, và khối thông tin an ninh phù hợp. Hệ thống MUST NOT sử dụng bất kỳ chuỗi mock fallback mặc định nào (như "Vietcombank **** 6899", "hoanglong.le@gmail.com", "001095012847", "0912.845.678") khi dữ liệu của người dùng bị rỗng hoặc chưa hoàn tất định danh.

#### Scenario: Mở Drawer chi tiết khi click dòng người dùng
- **WHEN** Quản trị viên nhấp vào dòng của người dùng trong bảng danh sách
- **THEN** Drawer chi tiết người dùng trượt ra từ mép phải với độ rộng 480px, hiển thị đầy đủ thông tin KYC, số dư và thông tin chi tiết của người dùng đó

#### Scenario: Đóng Drawer chi tiết
- **WHEN** Quản trị viên nhấn nút Đóng hoặc nhấp vào vùng làm mờ bên ngoài Drawer
- **THEN** Drawer thu gọn và đóng lại, giao diện danh sách người dùng trở về trạng thái bình thường

#### Scenario: Hiển thị thông tin ngân hàng cho tài khoản chưa liên kết
- **WHEN** Quản trị viên mở Drawer của người dùng chưa có tài khoản ngân hàng liên kết (hoặc danh sách ngân hàng liên kết rỗng)
- **THEN** Mục "Ngân hàng liên kết" MUST hiển thị nhãn "Chưa liên kết" với màu chữ xám (#64748B) và font weight bình thường, không hiển thị tên ngân hàng hoặc số tài khoản giả định

#### Scenario: Hiển thị thông tin ngân hàng cho tài khoản đã liên kết
- **WHEN** Quản trị viên mở Drawer của người dùng đã liên kết ngân hàng (như Vietcombank số tài khoản 0332330072 của người dùng Dương Gian)
- **THEN** Mục "Ngân hàng liên kết" hiển thị tên ngân hàng cùng 4 số cuối của tài khoản thực tế theo định dạng "<Tên ngân hàng> **** <4 số cuối>" (ví dụ: "Vietcombank **** 0072")

#### Scenario: Hiển thị thông tin định danh và an ninh cho tài khoản chưa KYC
- **WHEN** Quản trị viên mở Drawer của người dùng có trạng thái KYC là "Chưa xác minh KYC" và không có email/CCCD
- **THEN** Mục "Địa chỉ Email" hiển thị email thật hoặc "Chưa cập nhật", mục "CCCD / Định danh" hiển thị "Chưa cập nhật", và khối thông báo an ninh hiển thị cảnh báo tài khoản chưa hoàn tất xác thực danh tính theo quy định

### Requirement: Hộp thoại xác nhận vô hiệu hóa người dùng
Hệ thống SHALL hiển thị hộp thoại xác nhận dạng cảnh báo nguy hiểm (Destructive Confirmation Dialog) độ rộng 440px khi quản trị viên chọn thao tác khóa/vô hiệu hóa tài khoản. Hộp thoại MUST hiển thị icon cảnh báo màu đỏ (#EF4444), cảnh báo hệ quả phong tỏa ví và bắt buộc người dùng nhập lý do vô hiệu hóa trước khi kích hoạt nút xác nhận.

#### Scenario: Vô hiệu hóa tài khoản người dùng thành công
- **WHEN** Quản trị viên mở hộp thoại xác nhận, nhập lý do "Phát hiện gian lận giao dịch" và nhấn nút "Vô hiệu hóa tài khoản"
- **THEN** Trạng thái người dùng được cập nhật sang "Đã khóa" với badge màu đỏ và hộp thoại đóng lại

### Requirement: Lịch sử giao dịch của người dùng trên Web Admin
Hệ thống SHALL cung cấp API và giao diện cho phép Quản trị viên xem lịch sử giao dịch chi tiết của từng người dùng cụ thể. API MUST yêu cầu xác thực bằng Access Token của tài khoản có vai trò `ADMIN`. Hệ thống MUST hỗ trợ lọc giao dịch theo các khoảng thời gian chuẩn (`period`: `day`, `week`, `month`) hoặc khoảng ngày tùy chọn (`start_date`, `end_date`), tìm kiếm theo từ khóa (`keyword`) và phân trang (`page`, `limit`). Dữ liệu trả về MUST bao gồm đầy đủ số điện thoại của đối tác mà không che dấu để phục vụ công tác đối soát.

#### Scenario: Quản trị viên lấy danh sách giao dịch của người dùng thành công
- **WHEN** Quản trị viên gửi yêu cầu `GET /api/v2/admin/user/:id/transactions` với token Admin hợp lệ
- **THEN** Hệ thống trả về mã trạng thái 200 kèm danh sách các giao dịch có liên quan đến người dùng (người gửi hoặc người nhận) được sắp xếp theo thời gian mới nhất trước

#### Scenario: Lọc giao dịch theo khoảng thời gian chuẩn
- **WHEN** Quản trị viên truyền tham số `period=week`
- **THEN** Hệ thống chỉ trả về các giao dịch phát sinh từ đầu tuần hiện tại đến thời điểm hiện tại

#### Scenario: Lọc giao dịch theo khoảng ngày tùy chọn
- **WHEN** Quản trị viên truyền tham số `start_date=2026-10-01` và `end_date=2026-10-21`
- **THEN** Hệ thống chỉ trả về các giao dịch phát sinh trong khoảng thời gian từ `2026-10-01 00:00:00` đến `2026-10-21 23:59:59`

#### Scenario: Tìm kiếm giao dịch theo từ khóa
- **WHEN** Quản trị viên truyền tham số `keyword=Vietcombank` hoặc số điện thoại đối tác
- **THEN** Bảng kết quả chỉ chứa các giao dịch có tên ngân hàng, nội dung hoặc thông tin đối tác khớp với từ khóa tìm kiếm

#### Scenario: Truy vấn giao dịch của người dùng không tồn tại
- **WHEN** Quản trị viên gửi yêu cầu với một `id` người dùng không tồn tại trong hệ thống
- **THEN** Hệ thống trả về mã lỗi 404 với thông báo "Không tìm thấy người dùng"

#### Scenario: Người dùng không có quyền quản trị viên cố gắng truy cập
- **WHEN** Một tài khoản có vai trò `USER` gửi yêu cầu đến `GET /api/v2/admin/user/:id/transactions`
- **THEN** Hệ thống từ chối truy cập và trả về mã lỗi 403 Forbidden

### Requirement: Quản trị viên cập nhật trực tiếp thông tin người dùng
Hệ thống SHALL cung cấp API và giao diện Web Admin cho phép Quản trị viên cập nhật trực tiếp thông tin cá nhân của người dùng (`role = 'USER'`) bao gồm Họ và tên (`full_name`), Số điện thoại (`phone`), và Email (`email`). Thao tác MUST yêu cầu xác thực bằng Access Token của tài khoản có vai trò `ADMIN` và bắt buộc cung cấp lý do chỉnh sửa (`reason`).

#### Scenario: Cập nhật thông tin người dùng thành công
- **WHEN** Quản trị viên gửi yêu cầu `PATCH /api/v2/admin/user/:id/profile` với dữ liệu hợp lệ (họ tên, SĐT chưa trùng, email chưa trùng, lý do chỉnh sửa đầy đủ)
- **THEN** Hệ thống lưu thông tin mới vào bảng `users`, cập nhật `updated_at`, và trả về mã `200 OK` kèm toàn bộ dữ liệu chi tiết người dùng đã cập nhật

#### Scenario: Tự động tính toán phone_hash khi đổi số điện thoại
- **WHEN** Quản trị viên thay đổi số điện thoại của người dùng sang một số điện thoại mới hợp lệ
- **THEN** Hệ thống MUST tự động tính toán lại `phone_hash` bằng thuật toán SHA-256 từ số điện thoại mới và lưu vào cơ sở dữ liệu để đảm bảo các tính năng tra cứu danh bạ ví vẫn hoạt động chính xác

#### Scenario: Ngắt phiên đăng nhập cũ và phát socket force_logout
- **WHEN** Quản trị viên cập nhật thành công số điện thoại hoặc email của người dùng
- **THEN** Hệ thống MUST đặt `refresh_token = NULL` và `fcm_token = NULL` của tài khoản đó, đồng thời kích hoạt sự kiện Socket.io `force_logout` với thông điệp lý do tới thiết bị người dùng

#### Scenario: Từ chối khi trùng số điện thoại hoặc email
- **WHEN** Quản trị viên cập nhật số điện thoại hoặc email mà giá trị mới đã thuộc về một tài khoản người dùng khác trong hệ thống
- **THEN** Hệ thống MUST từ chối yêu cầu và trả về lỗi `409 Conflict` kèm thông tin trường bị trùng lặp

#### Scenario: Từ chối khi thiếu lý do chỉnh sửa
- **WHEN** Quản trị viên gửi yêu cầu cập nhật thông tin nhưng không cung cấp trường `reason` hoặc `reason` bị rỗng
- **THEN** Hệ thống MUST từ chối yêu cầu và trả về mã lỗi `400 Bad Request`

### Requirement: Giao diện hộp thoại chỉnh sửa thông tin trên Web Admin
Hệ thống SHALL hiển thị nút "Chỉnh sửa" tại thẻ Thông tin định danh & bảo mật trong `UserDetailDrawer`. Khi nhấn vào, hệ thống MUST hiển thị hộp thoại `EditUserProfileDialog` cho phép nhập Họ tên, Số điện thoại, Email và Lý do chỉnh sửa kèm cơ chế kiểm tra tính hợp lệ trước khi gửi yêu cầu. Khi cập nhật thành công, giao diện Drawer và bảng danh sách MUST tự động cập nhật dữ liệu mới mà không cần tải lại toàn bộ trang.

#### Scenario: Mở hộp thoại chỉnh sửa với dữ liệu khởi tạo
- **WHEN** Quản trị viên nhấn nút "Chỉnh sửa" tại thẻ Thông tin định danh trong Drawer chi tiết người dùng
- **THEN** Hộp thoại hiển thị form với các trường Họ tên, SĐT, Email được điền sẵn theo dữ liệu hiện tại của người dùng và ô Lý do chỉnh sửa để trống

#### Scenario: Cập nhật giao diện tức thì sau khi lưu thành công
- **WHEN** Quản trị viên điền form hợp lệ và nhấn "Lưu thay đổi", nhận phản hồi thành công từ API
- **THEN** Hộp thoại đóng lại, hiển thị thông báo SnackBar thành công, dữ liệu trong Drawer và dòng tương ứng trên bảng danh sách người dùng được cập nhật ngay lập tức

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

### Requirement: Nút bấm mở hộp thoại chuyển tiền P2P trên UserDetailDrawer
Hệ thống SHALL hiển thị nút bấm "Lệnh Chuyển tiền P2P" (icon `⇄`, kiểu dáng nổi bật) đặt trực tiếp trong thẻ Số dư khả dụng của `UserDetailDrawer`. Khi Quản trị viên nhấp vào nút này, hệ thống MUST kích hoạt hiển thị hộp thoại `AdminP2PTransferDialog` tương ứng với người dùng đang xem.

#### Scenario: Quản trị viên nhấp nút mở hộp thoại chuyển tiền
- **WHEN** Quản trị viên đang xem chi tiết người dùng tại `UserDetailDrawer` và nhấp vào nút "Lệnh Chuyển tiền P2P"
- **THEN** Hệ thống hiển thị hộp thoại `AdminP2PTransferDialog` lên trên màn hình

### Requirement: Giao diện hộp thoại tĩnh AdminP2PTransferDialog
Hệ thống SHALL cung cấp hộp thoại tĩnh `AdminP2PTransferDialog` hiển thị đầy đủ bố cục các thành phần: thông tin ví nguồn, ô ví thụ hưởng, ô số tiền và các chip chọn nhanh, lý do can thiệp, mã văn bản ủy quyền, nội dung giao dịch, và ô mật khẩu Admin. Hộp thoại hoạt động ở chế độ hiển thị thuần túy; thao tác nhấn "Hủy bỏ" hoặc "Xác nhận" MUST chỉ đóng hộp thoại mà không thực thi logic tính toán hay biến đổi dữ liệu người dùng.

#### Scenario: Đóng hộp thoại khi nhấn Hủy hoặc Xác nhận
- **WHEN** Quản trị viên nhấp vào nút "Hủy Bỏ", icon đóng, hoặc nút "Xác Nhận" trên hộp thoại `AdminP2PTransferDialog`
- **THEN** Hệ thống đóng hộp thoại và giữ nguyên 100% dữ liệu cùng số dư hiện tại của người dùng




