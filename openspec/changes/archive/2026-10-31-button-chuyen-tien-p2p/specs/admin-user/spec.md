# Spec Delta

## ADDED Requirements

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
