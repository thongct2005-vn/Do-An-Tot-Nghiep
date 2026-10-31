# Design

## Context

Ứng dụng `web-admin` (Flutter Web) hiện có màn hình quản lý người dùng `UserListScreen` và ngăn trượt chi tiết `UserDetailDrawer`. 

Theo yêu cầu điều chỉnh từ người dùng: *"chỉ thiết kế và hiển thị lên khi ấn vào thôi không gắn logic chức năng"*, bản thiết kế này loại bỏ toàn bộ các cơ chế xử lý logic, validation phức tạp hay mock state trừ tiền, chuyển sang mô hình widget hiển thị thuần túy (Presentation / Static UI) để phục vụ việc xem và đánh giá trực quan trên giao diện.

## Goals / Non-Goals

**Goals:**
- Bổ sung nút bấm "Lệnh Chuyển tiền P2P" nổi bật trong thẻ Số dư khả dụng của `UserDetailDrawer`.
- Xây dựng widget `AdminP2PTransferDialog` hiển thị đầy đủ bố cục, màu sắc, typography và các trường thông tin chuẩn theo thiết kế hệ sinh thái E-Wallet Admin.
- Cho phép người dùng click vào nút để mở hộp thoại và click đóng/hủy để tắt hộp thoại một cách mượt mà.

**Non-Goals:**
- Không gắn logic validation dữ liệu đầu vào.
- Không gắn logic tính toán hoặc trừ số dư ví (giữ nguyên state người dùng).
- Không gọi backend API hay bất kỳ network service nào.

## Decisions

### 1. Kiến trúc Widget hiển thị thuần túy (Presentation-only Dialog)
- **Lựa chọn:** Xây dựng `AdminP2PTransferDialog` tập trung vào cấu trúc hiển thị visual (Header, thẻ ví nguồn, các TextField có hint text mẫu, hàng Chip chọn tiền, Dropdown lý do và Footer chứa 2 nút Hủy / Xác nhận).
- **Lý do:** Đáp ứng chính xác yêu cầu xem trước giao diện. Việc không gắn logic giúp code nhẹ, an toàn, không sinh lỗi biên dịch hay lỗi state phụ thuộc.

### 2. Hành vi đóng hộp thoại đồng nhất
- **Lựa chọn:** Cả nút "Hủy Bỏ", icon `close` góc phải và nút "Xác Nhận & Thực Hiện" đều gọi `Navigator.of(context).pop()`.
- **Lý do:** Giúp người dùng thoải mái bấm thử các nút để xem hiệu ứng hover, active mà không gây bất kỳ tác động phụ (side-effects) nào lên dữ liệu.

### 3. Sẵn sàng cho việc gắn logic ở giai đoạn sau
- **Lựa chọn:** Giữ nguyên các ID trường, tên thuộc tính và cấu trúc widget chuẩn theo thiết kế API backend để khi người dùng duyệt xong giao diện, việc gắn logic và API sau này sẽ diễn ra liền mạch mà không phải đập đi xây lại giao diện.

## Risks / Trade-offs

- **[Giao diện không phản hồi khi bấm xác nhận]** → *Giải pháp:* Hộp thoại sẽ đóng lại nhẹ nhàng khi bấm Xác nhận để người dùng thấy thao tác đã được tiếp nhận ở mức UI.
