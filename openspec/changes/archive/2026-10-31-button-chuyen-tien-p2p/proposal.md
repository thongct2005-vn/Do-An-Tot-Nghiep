# Proposal

## Why

Phía Backend đã có sẵn API nghiệp vụ `POST /api/v2/admin/user/:id/operations/p2p` hỗ trợ Quản trị viên can thiệp điều phối dòng tiền P2P giữa hai tài khoản ví. Tuy nhiên, trên ứng dụng Flutter `web-admin` hiện tại hoàn toàn chưa có giao diện nào cho tính năng này.

Theo yêu cầu từ người dùng: *"chỉ thiết kế và hiển thị lên khi ấn vào thôi không gắn logic chức năng"*, thay đổi này tập trung 100% vào việc dựng giao diện tĩnh (Pure UI / Presentation-only), bao gồm nút bấm trên ngăn trượt hồ sơ người dùng và hộp thoại hiển thị đầy đủ bố cục các trường thông tin. Thay đổi này không gắn bất kỳ logic tính toán, không validate, không trừ số dư giả lập và không gọi API, nhằm giúp người dùng kiểm tra trực quan về mặt thẩm mỹ và trải nghiệm bố cục trước khi quyết định triển khai logic.

## What Changes

- **Bổ sung nút bấm "Lệnh Chuyển tiền P2P" trên `UserDetailDrawer`**: Đặt bên trong thẻ hiển thị số dư khả dụng màu xanh của hồ sơ người dùng.
- **Xây dựng Widget Hộp thoại tĩnh `AdminP2PTransferDialog`**:
  - Khối thông tin ví nguồn (Họ tên, SĐT, ID, Số dư hiển thị tĩnh theo user đang chọn).
  - Khối ví thụ hưởng (Ô nhập SĐT/ID người nhận, thẻ xem trước tên đối tác mẫu).
  - Khối số tiền chuyển (Ô nhập tiền mẫu và các chip chọn nhanh 100k, 200k, 500k, 1M, 5M, Tối đa).
  - Khối kiểm toán pháp lý (Dropdown danh mục lý do mẫu, ô mã văn bản ủy quyền, ô nội dung chuyển tiền).
  - Khối an ninh (Ô nhập mật khẩu Admin).
- **Hành vi hiển thị thuần túy (Không gắn logic chức năng)**:
  - Nhấn nút "Lệnh Chuyển tiền P2P" -> Mở `AdminP2PTransferDialog` qua `showDialog`.
  - Nhấn "Hủy bỏ", icon đóng hoặc nút "Xác nhận" -> Chỉ đơn thuần đóng hộp thoại (`Navigator.of(context).pop()`).
  - Không validate bắt buộc, không tính toán trừ tiền, không thay đổi số dư ví người dùng, không tạo request mạng.

## Capabilities

### Modified Capabilities
- `admin-user`: Bổ sung yêu cầu giao diện hiển thị thuần túy (Presentation UI) cho chức năng Chuyển tiền P2P của Quản trị viên trên Web Admin (nút bấm tại `UserDetailDrawer` và hộp thoại `AdminP2PTransferDialog`).

## Impact
- **Mã nguồn ảnh hưởng (`web-admin`)**:
  - `web-admin/lib/features/user/presentation/widgets/user_detail_drawer.dart`: Thêm nút bấm mở hộp thoại.
  - `web-admin/lib/features/user/presentation/widgets/admin_p2p_transfer_dialog.dart`: Tạo mới widget hiển thị giao diện hộp thoại tĩnh.
- **Backend**: Không bị ảnh hưởng.
