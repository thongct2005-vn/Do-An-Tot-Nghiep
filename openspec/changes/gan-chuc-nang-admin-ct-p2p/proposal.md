# Proposal: Gắn chức năng chuyển tiền P2P do Admin thực hiện trên Web Admin (gan-chuc-nang-admin-ct-p2p)

## Why

Hiện tại Backend đã có đầy đủ API `POST /api/v2/admin/user/:id/operations/p2p` (xác thực mật khẩu Admin, kiểm tra `authorization_reference`, đảm bảo `Idempotency-Key` nguyên tử và ghi lịch sử kiểm toán hai chiều), nhưng nút **"Lệnh Chuyển tiền P2P"** và hộp thoại `AdminP2PTransferDialog` trên Flutter Web Admin vẫn đang ở chế độ giao diện tĩnh (chỉ đóng hộp thoại khi bấm mà chưa thực thi nghiệp vụ). Việc tích hợp đầy đủ luồng tra cứu đối soát người nhận chính xác, bước xác nhận giao dịch cuối cùng, quản lý `Idempotency-Key` chuẩn và đồng bộ tức thì số dư cùng lịch sử giao dịch là cần thiết để hoàn thiện trọn vẹn tính năng can thiệp chuyển tiền P2P của Quản trị viên.

## What Changes

- **Vô hiệu hóa thao tác khi ví nguồn bị khóa (`BLOCKED`)**:
  - Trên `UserDetailDrawer`, khi tài khoản người dùng đang ở trạng thái `UserStatus.suspended` (`BLOCKED`), nút **"Lệnh Chuyển tiền P2P"** được vô hiệu hóa (`disabled`) kèm thông báo giải thích rõ lý do tài khoản đang bị khóa, không cho phép mở hộp thoại thực hiện giao dịch.
- **Bổ sung thông tin hạn mức đã dùng trong ngày (`daily_used`) vào API chi tiết người dùng**:
  - Cập nhật `adminUserRepository.getUserDetail` và `adminUserService.getUserDetail` (`GET /api/v2/admin/user/:id`) trả thêm `daily_limit` (`50000000`) và `daily_used` (tổng số tiền + phí các giao dịch `TRANSFER`, `WITHDRAW`, `PAYMENT` thành công trong ngày của người dùng) để Flutter `UserModel` tính chính xác số tiền chuyển tối đa khả dụng.
- **Nâng cấp `AdminP2PTransferDialog` từ giao diện tĩnh sang luồng nghiệp vụ 2 bước (2-Step Confirmation)**:
  - Loại bỏ toàn bộ dữ liệu mẫu cố định (hardcoded mock values) trong các ô nhập liệu.
  - **Bước 1 — Nhập thông tin & Đối soát chính xác người nhận**:
    - Nhập Số điện thoại (10 chữ số) hoặc UUID người nhận (tự động tra cứu với debounce `350ms` hoặc bấm nút Tra cứu).
    - Kiểm tra **khớp chính xác 100%** theo số điện thoại (`phone == input`) hoặc UUID (`id == input`), tuyệt đối không tự động lấy phần tử đầu tiên trong kết quả tìm kiếm gần đúng.
    - Xác minh người nhận có trạng thái `ACTIVE` và không trùng với ví nguồn (`id != sourceUser.id`); hiển thị cảnh báo đỏ và chặn tiếp tục nếu người nhận không tồn tại, trùng ví nguồn hoặc đang bị khóa (`BLOCKED`).
    - Tính toán số tiền chuyển tối đa theo công thức có xét phí giao dịch và hạn mức còn lại trong ngày: `max(0, min(balance - fee, dailyLimit - dailyUsed - fee, 50000000))`.
    - Cho phép chọn lý do can thiệp nghiệp vụ (hỗ trợ nhập lý do chi tiết khi chọn *"Lý do nghiệp vụ khác..."*), nhập mã văn bản/ticket ủy quyền (`authorization_reference` khớp `/^[A-Za-z0-9_-]{5,100}$/`) và nội dung chuyển tiền.
  - **Bước 2 — Bảng đối chiếu xác nhận cuối cùng & Ký duyệt mật khẩu Admin**:
    - Hiển thị bảng đối chiếu thông tin chỉ đọc: Người gửi (Tên & SĐT), Người nhận (Tên & SĐT đã đối soát), Số tiền chuyển, Phí giao dịch (`0 đ`), Lý do thực hiện, Mã phiếu ủy quyền (`authorization_reference`), Nội dung sao kê và ghi chú giả định nghiệp vụ mô phỏng phiếu ủy quyền hỗ trợ khách hàng.
    - Yêu cầu nhập mật khẩu Admin hiện tại (`admin_password`) để ký duyệt và gửi API `POST /api/v2/admin/user/:id/operations/p2p`, hoặc cho phép bấm *"Quay lại chỉnh sửa"* để về Bước 1.
- **Quản lý `Idempotency-Key` chuẩn bằng UUID ngẫu nhiên tại Client**:
  - Sinh một UUID v4 ngẫu nhiên cho mỗi lệnh chuyển tiền mới (không cố định theo hash nội dung form để cho phép thực hiện hai giao dịch hợp lệ có cùng nội dung ở hai thời điểm khác nhau).
  - Giữ nguyên `Idempotency-Key` khi gặp lỗi mạng / timeout chưa rõ kết quả để chống trừ tiền hai lần khi bấm gửi lại; tự động sinh UUID mới khi Admin chỉnh sửa thông tin giao dịch hoặc sau khi Backend trả về lỗi nghiệp vụ xác nhận giao dịch chưa thực thi (`400`, `401`, `403`, `422`).
- **Đồng bộ giao diện bằng tín hiệu làm mới tường minh (Explicit Refresh Signal)**:
  - Sau khi chuyển tiền thành công, phát tín hiệu làm mới rõ ràng (`transactionRefreshTick` / callback) từ `UserListScreen` xuống `UserDetailDrawer` và `_UserTransactionsSection` để tải lại chi tiết người dùng (số dư mới, hạn mức ngày), cập nhật bảng danh sách người dùng (cả ví nguồn và ví nhận nếu đang hiển thị), và tải lại trang đầu tiên của lịch sử giao dịch mà không phụ thuộc ngầm vào sự thay đổi của `user.balance`.

## Capabilities

### New Capabilities
<!-- Không tạo capability mới; mở rộng trực tiếp capability `admin-user` hiện có -->

### Modified Capabilities
- `admin-user`: Cập nhật yêu cầu đối với nút mở hộp thoại chuyển tiền P2P trên `UserDetailDrawer` (vô hiệu hóa khi ví nguồn `BLOCKED`, nhận tín hiệu làm mới lịch sử giao dịch), thay thế yêu cầu hộp thoại tĩnh `AdminP2PTransferDialog` bằng yêu cầu hộp thoại nghiệp vụ chuyển tiền P2P 2 bước (đối soát chính xác người nhận, công thức hạn mức tối đa, quản lý `Idempotency-Key` bằng UUID và xác thực mật khẩu Admin), đồng thời bổ sung thông tin hạn mức giao dịch ngày (`daily_used`, `daily_limit`) trong chi tiết người dùng.

## Impact

- **Backend (`backend/src/admin/user/`)**:
  - `user.repository.js` & `user.service.js`: Bổ sung truy vấn `daily_used` và trả về `daily_limit`, `daily_used` trong `getUserDetail(userId)`.
- **Frontend (`web-admin/lib/`)**:
  - `core/network/api_constants.dart`: Bổ sung endpoint `adminUserP2PTransfer(String id)`.
  - `features/user/models/user_model.dart`: Cập nhật `UserModel.copyWith` hỗ trợ `balance`, `dailyLimit`, `dailyUsed`.
  - `features/user/data/user_api_service.dart`: Bổ sung model `AdminP2PTransferResult` và hàm `executeAdminP2P(...)` gửi kèm header `Idempotency-Key`.
  - `features/user/presentation/widgets/admin_p2p_transfer_dialog.dart`: Triển khai luồng 2 bước, tra cứu đối soát chính xác người nhận, quản lý `Idempotency-Key` UUID, xử lý lỗi và gọi API.
  - `features/user/presentation/widgets/user_detail_drawer.dart` & `features/user/presentation/user_list_screen.dart`: Khóa nút P2P khi tài khoản `BLOCKED` kèm thông báo lý do, truyền tín hiệu làm mới tường minh (`transactionRefreshTick`) để đồng bộ số dư và lịch sử giao dịch sau khi chuyển tiền thành công.

