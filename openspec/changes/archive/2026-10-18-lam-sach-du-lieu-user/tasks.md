# Tasks

## 1. Backend: Tối ưu truy vấn dữ liệu ngân hàng & chuẩn hóa Service

- [x] 1.1 Cập nhật câu truy vấn SQL trong `backend/src/admin/user/user.repository.js` sử dụng `LEFT JOIN LATERAL` với `ORDER BY lba.is_default DESC, lba.created_at DESC LIMIT 1` để truy vấn chính xác ngân hàng liên kết của người dùng kể cả khi mang cờ `is_default = false`, xác minh dữ liệu trả về cho các tài khoản trong database.
- [x] 1.2 Rà soát và chuẩn hóa `backend/src/admin/user/user.service.js` đảm bảo người dùng chưa có tài khoản ngân hàng liên kết sẽ trả về `bank_name: "Chưa liên kết"` và `bank_account: ""` thay vì để trường dữ liệu rỗng gây lỗi fallback.

## 2. Flutter Web Admin: Làm sạch hiển thị trong UserDetailDrawer

- [x] 2.1 Cập nhật hàm `_formatBankAccount` và widget `_buildInfoRow` trong `web-admin/lib/features/user/presentation/widgets/user_detail_drawer.dart`: loại bỏ hoàn toàn chuỗi ép cứng `'Vietcombank'` và `'**** 6899'`; trả về `'Chưa liên kết'` với màu xám `#64748B` khi người dùng chưa liên kết; hiển thị đúng định dạng `"$bankName **** $last4Digits"` khi có tài khoản thật.
- [x] 2.2 Loại bỏ các chuỗi mock fallback khác trong `user_detail_drawer.dart`: hiển thị email thật hoặc `'Chưa cập nhật'`, số điện thoại thật hoặc `'Chưa cập nhật'`, số CCCD từ `user.kycDetail?.cccdNumber` hoặc `'Chưa cập nhật'`, định dạng mã USR từ ID thật.
- [x] 2.3 Điều chỉnh nội dung khối thông báo an ninh trong `user_detail_drawer.dart` hiển thị linh hoạt theo trạng thái KYC thực tế của người dùng thay vì hiển thị tĩnh chuẩn FIDO2 cho tài khoản chưa xác minh.

## 3. Kiểm thử hồi quy & Xác thực

- [x] 3.1 Chạy test suite `flutter test test/user_api_service_test.dart` và `flutter test test/widget_test.dart` để xác minh tất cả test case Quản lý người dùng đều vượt qua.
- [x] 3.2 Chạy `flutter analyze` trên `web-admin` để đảm bảo code sạch, không phát sinh lỗi phân tích tĩnh.
