# Tasks: Gắn chức năng chuyển tiền P2P do Admin thực hiện trên Web Admin (gan-chuc-nang-admin-ct-p2p)

## 1. Bổ sung Hạn mức Ngày đã dùng (`daily_used`) vào API Chi tiết Người dùng (Backend)

- [x] 1.1 Cập nhật `adminUserRepository.getUserDetail` và `adminUserService.getUserDetail` trong `backend/src/admin/user/` để truy vấn và trả về `daily_limit` (`50000000`) cùng `daily_used` (tổng `amount + fee` các giao dịch `TRANSFER`, `WITHDRAW`, `PAYMENT` thành công trong ngày của người dùng); cập nhật mock SQL trong `backend/tests/admin_user_p2p.test.js` và chạy `node --test backend/tests/admin_user_p2p.test.js` để xác nhận toàn bộ test cases đều PASS

## 2. Mở rộng Tầng Mạng và Model Dữ liệu trên Flutter Web Admin

- [x] 2.1 Bổ sung hằng số endpoint `adminUserP2PTransfer(String id)` trong `web-admin/lib/core/network/api_constants.dart` và cập nhật `UserModel.copyWith` trong `web-admin/lib/features/user/models/user_model.dart` để hỗ trợ cập nhật `balance`, `dailyLimit`, `dailyUsed`; kiểm tra bằng `flutter analyze` không phát sinh lỗi
- [x] 2.2 Bổ sung class `AdminP2PTransferResult` và phương thức `executeAdminP2P(...)` (truyền header `Idempotency-Key` và body chuẩn theo Backend, phân biệt mã lỗi HTTP trong `UserApiException`) trong `web-admin/lib/features/user/data/user_api_service.dart`; xác nhận biên dịch sạch với `flutter analyze`

## 3. Triển khai Hộp thoại `AdminP2PTransferDialog` Hai Bước & Quản lý `Idempotency-Key`

- [x] 3.1 Nâng cấp `web-admin/lib/features/user/presentation/widgets/admin_p2p_transfer_dialog.dart`: xóa toàn bộ giá trị mẫu cố định, triển khai Bước 1 gồm tra cứu đối soát chính xác người nhận theo SĐT 10 số hoặc UUID (debounce `350ms` + nút Tra cứu, chỉ chấp nhận khớp chính xác `phone == input` hoặc `id == input`, chặn khi trùng ví nguồn hoặc người nhận bị `BLOCKED`), tính số tiền tối đa theo công thức `max(0, min(balance - fee, dailyLimit - dailyUsed - fee, 50000000))`, hỗ trợ nhập lý do chi tiết khi chọn *"Lý do nghiệp vụ khác..."* và kiểm tra hợp lệ `authorization_reference`; xác nhận qua `flutter analyze`
- [x] 3.2 Triển khai Bước 2 (Bảng đối chiếu xác nhận cuối cùng gồm Người gửi, Người nhận, Số tiền, Phí giao dịch, Lý do, Mã ủy quyền kèm chú thích giả định nghiệp vụ + ô nhập mật khẩu Admin) và máy trạng thái `Idempotency-Key` bằng UUID v4 (giữ nguyên key khi retry lỗi mạng `statusCode == 0`, sinh key mới khi sửa dữ liệu hoặc gặp lỗi nghiệp vụ `400/401/403/422`) trong `admin_p2p_transfer_dialog.dart`; xác nhận không có lỗi phân tích tĩnh qua `flutter analyze`

## 4. Tích hợp `UserDetailDrawer`, `UserListScreen` và Kiểm thử Tích hợp

- [x] 4.1 Cập nhật `web-admin/lib/features/user/presentation/widgets/user_detail_drawer.dart` và `web-admin/lib/features/user/presentation/user_list_screen.dart`: vô hiệu hóa nút *"Lệnh Chuyển tiền P2P"* kèm dòng thông báo lý do khi tài khoản nguồn đang `BLOCKED` (`UserStatus.suspended`), kết nối mở `AdminP2PTransferDialog` khi tài khoản `ACTIVE`, và truyền tín hiệu làm mới tường minh (`transactionRefreshTick`) xuống `_UserTransactionsSection` để đồng bộ tức thì số dư, danh sách người dùng và lịch sử giao dịch sau khi chuyển tiền thành công; chạy `flutter analyze` và `flutter test` để xác nhận toàn bộ kiểm thử đều PASS

## Workflow follow-up

- Sau khi triển khai hoàn tất bằng `/opsx-apply`, lưu trữ change bằng `/opsx-archive`.

