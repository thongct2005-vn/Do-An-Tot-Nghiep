# Proposal

## Why

Giao diện chi tiết người dùng (`UserDetailDrawer`) trên Flutter Web Admin hiện đang chứa nhiều chuỗi fallback giả định (mock fallbacks) như "Vietcombank **** 6899", "hoanglong.le@gmail.com", "001095012847", "0912.845.678". Điều này dẫn đến lỗi hiển thị sai lệch nghiêm trọng: những người dùng chưa xác minh KYC hoặc chưa từng liên kết ngân hàng vẫn bị hiển thị đã liên kết tài khoản Vietcombank. Đồng thời, câu truy vấn SQL tại backend (`adminUserRepository.getUsers`) sử dụng điều kiện `lba.is_default = true` khiến những tài khoản thực tế có liên kết ngân hàng trong `ewallet_db.sql` (nhưng mang cờ `is_default = false`) bị trả về `NULL`. Việc làm sạch dữ liệu hiển thị và tối ưu hóa truy vấn ngân hàng là cấp thiết để đảm bảo tính chính xác và nhất quán cho cổng Quản trị.

## What Changes

- **Backend (`backend/src/admin/user/`)**:
  - Cập nhật câu truy vấn danh sách người dùng trong `user.repository.js`: Chuyển sang `LEFT JOIN LATERAL` để lấy ngân hàng liên kết đang hoạt động (ưu tiên ngân hàng mặc định, nếu không có thì lấy ngân hàng liên kết mới nhất), khắc phục trường hợp bản ghi mang cờ `is_default = false` trong cơ sở dữ liệu `ewallet_db.sql`.
  - Chuẩn hóa phản hồi trong `user.service.js`: Trả về `bank_name: "Chưa liên kết"` và `bank_account: ""` khi người dùng thực sự chưa liên kết ngân hàng.
- **Flutter Web Admin (`web-admin/lib/features/user/`)**:
  - Làm sạch hàm `_formatBankAccount` trong `UserDetailDrawer`: Loại bỏ hoàn toàn chuỗi ép cứng `'Vietcombank'` và `'**** 6899'`. Nếu người dùng chưa liên kết hoặc số tài khoản rỗng, trả về đúng `'Chưa liên kết'` với màu chữ xám `#64748B`. Nếu có tài khoản thật, che 4 số cuối đúng theo dữ liệu thực.
  - Loại bỏ các chuỗi mock fallback khác trong `UserDetailDrawer`:
    - Email: Hiển thị email thật hoặc `'Chưa cập nhật'` (thay vì `'hoanglong.le@gmail.com'`).
    - Số điện thoại: Hiển thị định dạng số điện thoại thật hoặc `'Chưa cập nhật'` (thay vì `'0912.845.678'`).
    - Số CCCD: Hiển thị CCCD thật từ `user.kycDetail?.cccdNumber` hoặc `'Chưa cập nhật'` (thay vì `'001095012847'`).
    - Mã người dùng: Hiển thị định dạng USR từ ID thật hoặc `'USR-00000'` (thay vì `'USR-98214'`).
    - Khối thông báo an ninh: Điều chỉnh nội dung linh hoạt theo trạng thái KYC thật của người dùng thay vì thông báo tĩnh FIDO2 cho tài khoản chưa xác thực.
- **Phạm vi bảo lưu**: Giữ nguyên cơ chế mock fallback cho 2 phân hệ Giao dịch (`TransactionListScreen`) và Bảng điều khiển (`DashboardScreen`), không can thiệp.

## Capabilities

### New Capabilities
<!-- Không có capability mới -->

### Modified Capabilities
- `admin-user`: Cập nhật yêu cầu hiển thị trung thực dữ liệu định danh, ngân hàng liên kết và thông báo bảo mật trong Drawer chi tiết người dùng, đồng thời tối ưu câu truy vấn dữ liệu ngân hàng tại Backend.

## Impact

- **Mã nguồn bị ảnh hưởng**:
  - `backend/src/admin/user/user.repository.js`
  - `backend/src/admin/user/user.service.js`
  - `web-admin/lib/features/user/presentation/widgets/user_detail_drawer.dart`
  - `web-admin/test/user_api_service_test.dart` (kiểm tra tương thích)
- **Hệ thống & Dữ liệu**:
  - Tương thích 100% với dữ liệu thực trong PostgreSQL (`ewallet_db.sql`).
  - Không phá vỡ các API hiện có và không ảnh hưởng đến User App di động.
