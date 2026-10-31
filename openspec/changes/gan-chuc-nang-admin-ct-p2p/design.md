# Design: Gắn chức năng chuyển tiền P2P do Admin thực hiện trên Web Admin (gan-chuc-nang-admin-ct-p2p)

## Context

Backend đã cung cấp sẵn API `POST /api/v2/admin/user/:id/operations/p2p` ([user.routes.js](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/admin/user/user.routes.js#L16)) tái sử dụng lõi `TransactionRepository.executeTransfer` với cơ chế khóa dòng theo thứ tự ID tăng dần (`SELECT ... FOR UPDATE`), kiểm tra mật khẩu Admin (`verifyAdminStepUpPassword`), kiểm tra `Idempotency-Key` nguyên tử và ghi nhận nhật ký kiểm toán hai chiều vào `admin_user_change_history` (đã xác nhận qua 15 kịch bản kiểm thử trong `backend/tests/admin_user_p2p.test.js`).

Ở phía Flutter Web Admin (`web-admin/lib/features/user`), widget `AdminP2PTransferDialog` và nút **"Lệnh Chuyển tiền P2P"** trong `UserDetailDrawer` hiện đang ở trạng thái giao diện tĩnh (xem `proposal.md` - Why). Ngoài ra, API `GET /api/v2/admin/user/:id` hiện chưa trả về `daily_used` (tổng số tiền đã giao dịch trong ngày), khiến `UserModel.dailyUsed` trên Flutter luôn mặc định là `0`.

## Goals / Non-Goals

**Goals:**
- Kết nối trọn vẹn luồng chuyển tiền P2P của Quản trị viên từ `UserDetailDrawer` $\rightarrow$ `AdminP2PTransferDialog` $\rightarrow$ `UserApiService.executeAdminP2P` $\rightarrow$ `POST /api/v2/admin/user/:id/operations/p2p`.
- Đảm bảo đối soát người nhận chính xác tuyệt đối (exact match theo SĐT 10 số hoặc UUID), không dùng dropdown gợi ý danh sách người dùng khi gõ dở.
- Triển khai quy trình xác nhận 2 bước (Bước 1: Nhập & đối soát thông tin $\rightarrow$ Bước 2: Bảng đối chiếu xác nhận cuối cùng & Ký duyệt mật khẩu Admin).
- Quản lý vòng đời `Idempotency-Key` bằng UUID v4 ngẫu nhiên cho từng lệnh chuyển tiền mới, giữ nguyên khi retry lỗi mạng chưa rõ kết quả và sinh mới khi chỉnh sửa dữ liệu hoặc gặp lỗi nghiệp vụ xác định.
- Bổ sung `daily_used` và `daily_limit` vào `GET /api/v2/admin/user/:id` để tính chính xác hạn mức chuyển tối đa khả dụng.
- Đồng bộ giao diện sau khi chuyển tiền bằng tín hiệu làm mới tường minh (`transactionRefreshTick`), không phụ thuộc ngầm vào biến đổi `user.balance`.

**Non-Goals:**
- Không viết lại hoặc thay đổi logic lõi `TransactionRepository.executeTransfer` và `POST /api/v2/admin/user/:id/operations/p2p` ở Backend.
- Không triển khai dropdown autocomplete tìm kiếm người nhận theo tên hoặc một phần số điện thoại.
- Không tự động mở khóa tài khoản trong quy trình chuyển tiền (mở khóa và chuyển tiền là hai nghiệp vụ độc lập).
- Không xây dựng hệ thống quản lý/phê duyệt ticket độc lập ngoài phạm vi kiểm tra `authorization_reference` hiện tại (ghi rõ giả định nghiệp vụ mô phỏng mã phiếu ủy quyền).

## Decisions

### 1. Đối soát người nhận chính xác tuyệt đối (Exact Match theo SĐT hoặc UUID)
- **Lựa chọn**:
  - Khi Admin nhập đủ 10 chữ số điện thoại (`^0\d{9}$`) hoặc UUID hợp lệ (`^[0-9a-fA-F-]{36}$`) vào ô người nhận (tự động kích hoạt sau debounce `350ms` hoặc khi nhấn nút Tra cứu), gọi `UserApiService.getUsers(search: input, limit: 5)`.
  - Từ danh sách kết quả trả về, lọc tìm bản ghi duy nhất thỏa mãn **khớp chính xác**: `u.phone.trim() == cleanInput || u.id.trim().toLowerCase() == cleanInput.toLowerCase()`.
  - Tuyệt đối không dùng `items.first` nếu không khớp chính xác.
  - Kiểm tra điều kiện nghiệp vụ trên người nhận tìm được:
    - Nếu `recipient.id == sourceUser.id` $\rightarrow$ báo lỗi *"Không thể chuyển tiền cho chính tài khoản nguồn"*.
    - Nếu `recipient.status == UserStatus.suspended` (`BLOCKED`) $\rightarrow$ báo lỗi *"Tài khoản người nhận đang bị khóa, không thể nhận tiền"*.
    - Chỉ khi khớp chính xác 1 người nhận có `status == UserStatus.active` mới lưu `_verifiedRecipient = recipient` và cho phép chuyển sang Bước 2.
- **Lý do**: Ngăn chặn rủi ro chọn nhầm người thụ hưởng có tên/SĐT gần giống và tránh làm lộ danh sách người dùng khi gõ dở số điện thoại.
- **Phương án thay thế đã cân nhắc**:
  - *Dropdown autocomplete theo tên/SĐT gõ dở*: Bị loại bỏ vì dễ gây nhầm lẫn giữa các tài khoản trùng tên và không cần thiết cho nghiệp vụ tra soát theo hồ sơ ticket đã biết rõ SĐT/ID.

### 2. Vô hiệu hóa nút "Lệnh Chuyển tiền P2P" khi ví nguồn bị khóa (`BLOCKED`)
- **Lựa chọn**:
  - Tại `UserDetailDrawer`, kiểm tra `isSuspended` (`user.status == UserStatus.suspended`, ánh xạ từ `status == 'BLOCKED'` ở Backend).
  - Nếu `isSuspended == true`: đặt `onPressed: null` cho nút **"Lệnh Chuyển tiền P2P"** và hiển thị dòng chú thích cảnh báo ngay bên dưới nút: *"Tài khoản đang bị khóa. Không thể thực hiện chuyển tiền cho đến khi được kích hoạt lại."*
  - Backend vẫn giữ nguyên kiểm tra `status === 'ACTIVE'` sau khi khóa dòng `FOR UPDATE` để phòng trường hợp tài khoản bị khóa sau khi Dialog đã mở.
- **Lý do**: Tránh cho phép Admin mở hộp thoại nhập liệu khi biết chắc chắn Backend sẽ từ chối giao dịch của ví nguồn đang bị khóa.

### 3. Bổ sung `daily_used` vào `getUserDetail` và Công thức tính Số tiền tối đa
- **Lựa chọn**:
  - Trong `adminUserRepository.getUserDetail(userId)` ([user.repository.js](file:///d:/KH23_CNTT_HK6_DATN_CODE/backend/src/admin/user/user.repository.js#L90-L157)), thực hiện thêm truy vấn tổng số tiền đã giao dịch trong ngày của `userId`:
    ```sql
    SELECT COALESCE(SUM(amount + fee), 0)::BIGINT AS daily_used
    FROM transactions
    WHERE source_user_id = $1
      AND transaction_type IN ('TRANSFER', 'WITHDRAW', 'PAYMENT')
      AND status = 'SUCCESS'
      AND created_at >= date_trunc('day', NOW())
    ```
  - Trả về `daily_limit: 50000000` và `daily_used: Number(user.daily_used || 0)` trong `adminUserService.getUserDetail(userId)`. (`UserModel.fromJson` trên Flutter đã có sẵn logic đọc hai trường này).
  - Trên `AdminP2PTransferDialog`, tính số tiền chuyển tối đa khả dụng (có xét cả phí giao dịch `fee = 0` và hạn mức ngày còn lại):
    ```dart
    final remainingDailyLimit = (user.dailyLimit - user.dailyUsed - fee).clamp(0, 50000000);
    final maxByBalance = (user.balance - fee).clamp(0, 50000000);
    final maxTransferable = math.min(maxByBalance, remainingDailyLimit);
    ```
- **Lý do**: Đảm bảo nút chip *"Tối đa khả dụng"* và bộ kiểm tra hợp lệ trên UI khớp chính xác với điều kiện kiểm tra hạn mức ngày trong `TransactionRepository.executeTransfer`.

### 4. Quy trình 2 bước (2-Step Confirmation) trong `AdminP2PTransferDialog`
- **Lựa chọn**:
  - Quản lý biến trạng thái `int _currentStep = 1` (1: Nhập & đối soát thông tin; 2: Xác nhận cuối cùng & Nhập mật khẩu Admin) ngay trong `_AdminP2PTransferDialogState`:
    - **Bước 1**: Hiển thị thông tin ví nguồn, ô tra cứu đối soát người nhận, ô số tiền + quick chips, lý do can thiệp (nếu chọn *"Lý do nghiệp vụ khác..."* thì hiện thêm ô nhập lý do cụ thể), mã ủy quyền (`authorization_reference`), nội dung chuyển tiền. Nút hành động chính: **"Tiếp tục xác nhận"**.
    - **Bước 2**: Khi Bước 1 hợp lệ và đã có `_verifiedRecipient`, chuyển sang màn hình tóm tắt chỉ đọc gồm 7 hàng đối chiếu: **Người gửi** (Tên & SĐT), **Người nhận** (Tên & SĐT đã đối soát), **Số tiền chuyển**, **Phí giao dịch** (`0 đ`), **Lý do thực hiện**, **Mã ủy quyền** (`authorization_reference`), **Nội dung sao kê**, kèm chú thích giả định nghiệp vụ mô phỏng phiếu ủy quyền hỗ trợ khách hàng và khối **Xác thực Mật khẩu Quản trị viên**. Nút hành động: **"Quay lại chỉnh sửa"** (về Bước 1) và **"Xác Nhận & Thực Hiện Lệnh Chuyển"** (gọi API).
- **Lý do**: Giảm thiểu sai sót thao tác của Admin trước khi ký duyệt mật khẩu thực thi lệnh chuyển tiền thật.

### 5. Cơ chế quản lý `Idempotency-Key` bằng UUID v4 ngẫu nhiên
- **Lựa chọn**:
  - Tạo hàm sinh UUID v4 ngẫu nhiên (sử dụng `Random.secure()` theo chuẩn RFC 4122, không cần thêm thư viện ngoài) mỗi khi khởi tạo lệnh chuyển tiền mới (`_idempotencyKey`).
  - Quy tắc vòng đời `_idempotencyKey`:
    1. Khi mở Dialog: sinh UUID v4 mới.
    2. Khi Admin chỉnh sửa bất kỳ trường dữ liệu giao dịch nào ở Bước 1 (`recipient`, `amount`, `reason`, `authorization_reference`, `description`): đánh dấu và sinh UUID v4 mới.
    3. Khi gọi API gặp lỗi mạng / timeout (`statusCode == 0` hoặc lỗi kết nối không xác định kết quả): **giữ nguyên `_idempotencyKey`** hiện tại để nếu Admin nhấn gửi lại ngay ở Bước 2 thì Backend nhận diện đúng cùng một yêu cầu và không trừ tiền lần hai.
    4. Khi Backend trả về lỗi nghiệp vụ xác định rõ giao dịch chưa thực hiện (`statusCode` thuộc `400`, `401`, `403`, `422`): tự động sinh UUID v4 mới cho lần gửi tiếp theo.
- **Lý do**: Cho phép thực hiện hai giao dịch hợp lệ có cùng nội dung ở hai thời điểm khác nhau mà không bị coi nhầm là giao dịch lặp, đồng thời bảo vệ an toàn tuyệt đối khi mất mạng/timeout.

### 6. Đồng bộ giao diện bằng Tín hiệu Làm mới Tường minh (`transactionRefreshTick`)
- **Lựa chọn**:
  - Trong `_UserListScreenState`, bổ sung biến đếm `int _transactionRefreshTick = 0`.
  - Truyền `transactionRefreshTick: _transactionRefreshTick` và callback `onP2PTransferSuccess` xuống `UserDetailDrawer`, và từ `UserDetailDrawer` truyền `refreshTick: transactionRefreshTick` xuống `_UserTransactionsSection`.
  - Khi `AdminP2PTransferDialog` thực thi thành công và trả về `AdminP2PTransferResult`:
    1. `UserListScreen` tăng `_transactionRefreshTick++`, cập nhật ngay số dư ví nguồn từ kết quả trả về, đồng thời gọi `_loadData()` và `_apiService.getUserDetail(user.id)` để đồng bộ đầy đủ danh sách người dùng (cả ví nguồn và ví nhận) cùng hạn mức ngày mới.
    2. Trong `_UserTransactionsSection.didUpdateWidget`, kiểm tra `oldWidget.userId != widget.userId || oldWidget.refreshTick != widget.refreshTick` để đặt `_currentPage = 1` và gọi `_fetchTransactions()`.
- **Lý do**: Tách bạch rõ ràng tín hiệu làm mới giao dịch khỏi trạng thái `balance`, chuẩn kiến trúc hướng sự kiện/MVVM và dễ dàng tái sử dụng cho chức năng Nạp/Rút tiền của Admin về sau.

## Risks / Trade-offs

- **[Risk: Trạng thái tài khoản nguồn hoặc đích bị một Admin khác khóa trong lúc Admin đang mở Dialog ở Bước 1 hoặc Bước 2]** $\rightarrow$ *Mitigation*: Backend (`TransactionRepository.executeTransfer`) đã khóa dòng `SELECT ... FOR UPDATE` và kiểm tra lại `status === 'ACTIVE'` cho cả hai ví; nếu bị khóa đồng thời, Backend trả lỗi `403`, Dialog hiển thị thông báo lỗi rõ ràng và sinh `Idempotency-Key` mới.
- **[Risk: Mất kết nối mạng ngay sau khi Server vừa COMMIT giao dịch]** $\rightarrow$ *Mitigation*: Nhờ giữ nguyên `_idempotencyKey` khi `statusCode == 0`, khi Admin nhấn gửi lại ở Bước 2, Backend nhận ra key đã `SUCCESS` kèm cùng `request_hash` và trả lại nguyên vẹn kết quả giao dịch đầu tiên (`replayed: true`) mà không trừ tiền lần thứ hai.

## Migration Plan

1. Cập nhật `backend/src/admin/user/user.repository.js` và `user.service.js` để trả thêm `daily_limit` và `daily_used` trong `getUserDetail`.
2. Cập nhật các file trong `web-admin/lib/` (`api_constants.dart`, `user_model.dart`, `user_api_service.dart`, `admin_p2p_transfer_dialog.dart`, `user_detail_drawer.dart`, `user_list_screen.dart`).
3. Chạy kiểm thử Backend (`node --test backend/tests/admin_user_p2p.test.js`) và phân tích/kiểm thử Flutter (`flutter analyze`, `flutter test`).

