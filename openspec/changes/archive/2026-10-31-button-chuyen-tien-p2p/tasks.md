# Tasks

## 1. Xây dựng Widget Giao diện tĩnh `AdminP2PTransferDialog`

- [x] 1.1 Tạo mới widget `web-admin/lib/features/user/presentation/widgets/admin_p2p_transfer_dialog.dart` hiển thị tĩnh đầy đủ các khối giao diện: Header cảnh báo quản trị, thẻ thông tin ví nguồn, ô nhập ví thụ hưởng (kèm badge mẫu người nhận), ô nhập số tiền cùng các chip chọn nhanh VND, dropdown lý do can thiệp, ô mã văn bản ủy quyền, ô nội dung chuyển tiền, và ô nhập mật khẩu Admin; xác minh widget biên dịch thành công.
- [x] 1.2 Thiết lập hành vi đóng hộp thoại thuần túy qua `Navigator.of(context).pop()` cho nút "Hủy Bỏ", icon `close` và nút "Xác Nhận & Thực Hiện", không kèm theo bất kỳ logic tính toán hay biến đổi dữ liệu nào; xác minh thao tác đóng mở hoạt động mượt mà.

## 2. Tích hợp Nút bấm vào `UserDetailDrawer` và Kiểm tra Hiển thị

- [x] 2.1 Bổ sung nút bấm "Lệnh Chuyển tiền P2P" (nền trắng nổi bật, icon `⇄`, chữ xanh thương hiệu) đặt bên trong thẻ Số dư khả dụng tại `web-admin/lib/features/user/presentation/widgets/user_detail_drawer.dart`; xác minh nút hiển thị cân đối và rõ ràng trên Drawer.
- [x] 2.2 Đấu nối sự kiện `onPressed` của nút bấm để mở `AdminP2PTransferDialog` thông qua hàm `showDialog(...)`; xác minh click vào nút hiển thị đúng hộp thoại trên màn hình.
- [x] 2.3 Chạy kiểm tra phân tích cú pháp tĩnh trên thư mục `web-admin` đảm bảo toàn bộ mã nguồn sạch lỗi và sẵn sàng cho việc xem trước trực tiếp trên trình duyệt.
