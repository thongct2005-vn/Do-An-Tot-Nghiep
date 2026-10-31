# admin-user Specification Delta

## MODIFIED Requirements

### Requirement: Drawer hiển thị chi tiết người dùng tại chỗ
Hệ thống SHALL mở một ngăn trượt chi tiết (Slide-over Drawer) có chiều rộng 480px từ mép phải màn hình khi quản trị viên nhấp vào một dòng người dùng trong danh sách. Quá trình mở Drawer MUST diễn ra ngay tại màn hình danh sách mà không chuyển hướng trang. Drawer MUST hiển thị thông tin trung thực từ cơ sở dữ liệu bao gồm định danh KYC, thẻ số dư ví cá nhân kèm hạn mức giao dịch ngày (`daily_limit`) và tổng số tiền đã giao dịch trong ngày (`daily_used`), tài khoản ngân hàng liên kết thực tế, và khối thông tin an ninh phù hợp. Hệ thống MUST NOT sử dụng bất kỳ chuỗi mock fallback mặc định nào (như "Vietcombank **** 6899", "hoanglong.le@gmail.com", "001095012847", "0912.845.678") khi dữ liệu của người dùng bị rỗng hoặc chưa hoàn tất định danh.

#### Scenario: Mở Drawer chi tiết khi click dòng người dùng
- **WHEN** Quản trị viên nhấp vào dòng của người dùng trong bảng danh sách
- **THEN** Drawer chi tiết người dùng trượt ra từ mép phải với độ rộng 480px, hiển thị đầy đủ thông tin KYC, số dư, hạn mức giao dịch trong ngày (`daily_limit`, `daily_used`) và thông tin chi tiết của người dùng đó

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

### Requirement: Nút bấm mở hộp thoại chuyển tiền P2P trên UserDetailDrawer
Hệ thống SHALL hiển thị nút bấm "Lệnh Chuyển tiền P2P" (icon `⇄`, kiểu dáng nổi bật) đặt trực tiếp trong thẻ Số dư khả dụng của `UserDetailDrawer`. Khi tài khoản người dùng đang ở trạng thái hoạt động (`ACTIVE` / `UserStatus.active`), nhấp vào nút này MUST kích hoạt hiển thị hộp thoại `AdminP2PTransferDialog` tương ứng với người dùng đang xem. Khi tài khoản người dùng đang bị khóa (`BLOCKED` / `UserStatus.suspended`), hệ thống MUST vô hiệu hóa (`disabled`) nút "Lệnh Chuyển tiền P2P" và hiển thị thông báo giải thích rằng tài khoản đang bị khóa, không thể thực hiện chuyển tiền cho đến khi được kích hoạt lại.

#### Scenario: Quản trị viên nhấp nút mở hộp thoại chuyển tiền
- **WHEN** Quản trị viên đang xem chi tiết người dùng có trạng thái `ACTIVE` tại `UserDetailDrawer` và nhấp vào nút "Lệnh Chuyển tiền P2P"
- **THEN** Hệ thống hiển thị hộp thoại `AdminP2PTransferDialog` lên trên màn hình với các trường nhập liệu khởi tạo rỗng

#### Scenario: Vô hiệu hóa nút chuyển tiền khi tài khoản nguồn đang bị khóa
- **WHEN** Quản trị viên mở `UserDetailDrawer` của một người dùng đang ở trạng thái `BLOCKED` (`UserStatus.suspended`)
- **THEN** Nút "Lệnh Chuyển tiền P2P" ở trạng thái bị vô hiệu hóa (không thể nhấp) và giao diện hiển thị dòng cảnh báo "Tài khoản đang bị khóa. Không thể thực hiện chuyển tiền cho đến khi được kích hoạt lại."

## REMOVED Requirements

### Requirement: Giao diện hộp thoại tĩnh AdminP2PTransferDialog
**Reason**: Thay thế chế độ hiển thị tĩnh (Presentation-only preview) bằng luồng nghiệp vụ chuyển tiền P2P thực tế có xác nhận 2 bước, đối soát chính xác người nhận và kết nối API Backend.
**Migration**: Sử dụng requirement `Hộp thoại thực hiện chuyển tiền P2P hai bước trên Web Admin`.

## ADDED Requirements

### Requirement: Hộp thoại thực hiện chuyển tiền P2P hai bước trên Web Admin
Hệ thống SHALL cung cấp hộp thoại `AdminP2PTransferDialog` theo quy trình 2 bước kết nối với API `POST /api/v2/admin/user/:id/operations/p2p`. Hệ thống MUST đối soát người nhận khớp chính xác theo SĐT hoặc UUID, kiểm tra hạn mức khả dụng, hiển thị bảng đối chiếu trước khi xác thực mật khẩu Admin và sinh `Idempotency-Key` bằng UUID riêng cho mỗi lệnh.

#### Scenario: Đối soát người nhận khớp chính xác và đang hoạt động
- **WHEN** Quản trị viên nhập đủ 10 chữ số điện thoại hoặc UUID của một tài khoản người dùng tồn tại, có trạng thái `ACTIVE` và khác với ví nguồn
- **THEN** Hệ thống hiển thị thẻ đối soát người nhận đã xác minh kèm Họ tên, Số điện thoại và nhãn `ACTIVE`, cho phép tiếp tục sang bước xác nhận

#### Scenario: Chặn tiếp tục khi người nhận bị khóa hoặc trùng ví nguồn hoặc không khớp chính xác
- **WHEN** Quản trị viên nhập chuỗi tìm kiếm không khớp chính xác 100% với số điện thoại/UUID nào, hoặc khớp với chính ví nguồn, hoặc khớp với tài khoản người nhận đang ở trạng thái `BLOCKED`
- **THEN** Hệ thống hiển thị cảnh báo lỗi tương ứng ngay dưới ô người nhận và không cho phép chuyển sang bước xác nhận giao dịch

#### Scenario: Chuyển sang bước xác nhận cuối cùng và thực hiện giao dịch thành công
- **WHEN** Quản trị viên điền hợp lệ người nhận đã đối soát, số tiền trong hạn mức khả dụng (`max(0, min(balance - fee, dailyLimit - dailyUsed - fee, 50000000))`), lý do, mã ủy quyền (`authorization_reference`), nhấn "Tiếp tục xác nhận", kiểm tra bảng đối chiếu thông tin, nhập đúng mật khẩu Admin và nhấn "Xác Nhận & Thực Hiện Lệnh Chuyển"
- **THEN** Hệ thống gửi yêu cầu `POST /api/v2/admin/user/:id/operations/p2p` kèm header `Idempotency-Key` (UUID), đóng hộp thoại khi nhận phản hồi `200 OK` và hiển thị thông báo thực hiện thành công

#### Scenario: Giữ nguyên Idempotency-Key khi gửi lại do lỗi kết nối mạng
- **WHEN** Quản trị viên nhấn xác nhận gửi giao dịch nhưng gặp lỗi mất kết nối mạng hoặc timeout chưa rõ kết quả, sau đó nhấn gửi lại mà không thay đổi thông tin giao dịch
- **THEN** Hệ thống gửi lại yêu cầu với cùng `Idempotency-Key` đã sinh trước đó để đảm bảo không bị trừ tiền hai lần

#### Scenario: Sinh mới Idempotency-Key khi sửa thông tin giao dịch hoặc sau lỗi nghiệp vụ
- **WHEN** Giao dịch trả về lỗi nghiệp vụ xác định (như `401` sai mật khẩu hoặc `422` vượt hạn mức) hoặc Quản trị viên quay lại chỉnh sửa số tiền, người nhận, lý do, mã ủy quyền
- **THEN** Hệ thống sinh một `Idempotency-Key` (UUID) mới cho lần xác nhận tiếp theo

### Requirement: Đồng bộ số dư và lịch sử giao dịch bằng tín hiệu tường minh sau khi chuyển tiền
Hệ thống SHALL phát một tín hiệu làm mới dữ liệu tường minh từ `UserListScreen` xuống `UserDetailDrawer` và `_UserTransactionsSection` ngay sau khi giao dịch chuyển tiền P2P của Quản trị viên hoàn tất thành công, mà không phụ thuộc ngầm vào sự biến đổi của trường `balance`.

#### Scenario: Cập nhật đồng bộ giao diện sau khi chuyển tiền thành công
- **WHEN** API `POST /api/v2/admin/user/:id/operations/p2p` trả về kết quả thành công (`200 OK`)
- **THEN** `UserListScreen` làm mới dữ liệu danh sách người dùng và thông tin chi tiết ví nguồn, cập nhật ngay Số dư khả dụng và Hạn mức ngày trên `UserDetailDrawer`, đồng thời kích hoạt tín hiệu làm mới để `_UserTransactionsSection` tải lại trang đầu tiên của lịch sử giao dịch hiển thị giao dịch P2P vừa phát sinh
