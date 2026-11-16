# MongoDB cho thống kê đăng nhập App

Backend dùng `MONGODB_URI` để lưu sự kiện vào collection `user_login_events`.
URI phải chỉ rõ database. Production, sandbox và kiểm thử dùng database riêng.
Trong cùng database, collection `admin_action_logs` lưu dấu vết API quản trị viên.

## Cấu hình môi trường

Các URI sau chỉ là ví dụ cho MongoDB local, không có thông tin xác thực:

| Môi trường | Nguồn cấu hình | URI ví dụ |
| --- | --- | --- |
| Production | `backend/.env` hoặc biến môi trường máy chủ | `mongodb://127.0.0.1:27017/ewallet_audit_db` |
| Sandbox | `backend/.env.sandbox` | `mongodb://127.0.0.1:27017/ewallet_audit_sandbox` |
| Kiểm thử | Biến môi trường tiến trình kiểm thử | `mongodb://127.0.0.1:27017/ewallet_audit_test` |

Với Atlas hoặc MongoDB có xác thực, lấy URI của môi trường tương ứng và điền
tên database trong URI. Cấp tài khoản ứng dụng quyền đọc/ghi database đó.
Không sao chép URI thật vào mã nguồn, tài liệu, test fixture hoặc log.
Hai file `.env` và `.env.sandbox` đã nằm trong `.gitignore` của backend.

Chạy lệnh từ thư mục `backend`:

```powershell
npm.cmd run s
```

Lệnh trên nạp `.env`. Sandbox sử dụng:

```powershell
npm.cmd run sb
```

Biến môi trường đã đặt cho tiến trình có ưu tiên hơn cấu hình dotenv mặc định.
Sau khi sửa URI, khởi động lại backend. Xác nhận tên database thực tế khi kết nối;
không dùng thông báo có tên database viết cố định làm bằng chứng đã chọn đúng DB.

## Kiểm chứng khi triển khai change log-and-connect-mongodb

1. Kiểm tra kết nối và tên database; kiểm tra quyền đọc/ghi bằng một document thử
   có định danh riêng, rồi xóa đúng document thử. Không xóa collection ứng dụng.
2. Hoàn tất đăng nhập App qua OTP/TOTP và kiểm tra sự kiện `SUCCESS` tương ứng.
3. Gọi API `/api/v2/admin/user/login-stats` bằng phiên ADMIN hiện hành; sandbox
   dùng tiền tố `/sb/api/v2`. Đối chiếu số liệu trên màn hình Quản lý User.
4. Kiểm tra kỳ trống trả `200` với bucket 0; nguồn MongoDB không khả dụng phải
   trả `503` sau khi phần triển khai API của change hoàn tất.
5. Chỉ thử mất kết nối/phục hồi trên MongoDB kiểm thử riêng, tránh ngắt dịch vụ
   MongoDB dùng chung cho môi trường khác.

Kiểm thử báo cáo hiện có nhận `MERCHANT_TEST_MONGO_URI` và tự chọn database tạm.
Đọc kiểm thử trước khi chạy để xác nhận mọi thao tác dọn dẹp chỉ tác động database
tạm do lần chạy đó tạo ra.

## Audit hoạt động quản trị viên

Mỗi yêu cầu API thuộc `/admin`, gồm GET xem dữ liệu, thao tác ghi dữ liệu và
đăng nhập admin, tạo một document `admin_action_logs` sau khi có kết quả HTTP.
Document lưu `admin_id` nếu đã xác thực, `method`, route template, `target_id`
nếu route có tham số `:id`, `status_code`, `outcome`, `occurred_at`, thời lượng
và môi trường. Với đăng nhập thất bại, có thể có `email_hash` SHA-256 của email
đã chuẩn hóa để đối chiếu các lần thử, không lưu email gốc.

Audit không lưu body, response body, token, mật khẩu, OTP hoặc query string.
Thao tác chỉ diễn ra trong trình duyệt và không gọi API sẽ không có document
backend. MongoDB ghi audit theo cách không chặn phản hồi; khi MongoDB lỗi,
document có thể bị bỏ lỡ. Các bản ghi `admin_user_change_history` và
`audit_outbox` trong PostgreSQL tiếp tục là nguồn kiểm toán nghiệp vụ giao dịch.

## Phạm vi dữ liệu và mốc bắt đầu thu thập

Ghi log đăng nhập là best-effort: lỗi MongoDB không được chặn cấp token.
Sự kiện trong thời gian MongoDB mất kết nối hoặc trước lúc bật ghi log có thể
không tồn tại. Kết nối lại không tự khôi phục các sự kiện đã mất.

Khi nghiệm thu từng môi trường, ghi lại tên database, thời điểm sự kiện đăng nhập
đầu tiên được lưu thành công và kết quả đối chiếu API/biểu đồ trong biên bản triển
khai. Dùng thời điểm có bằng chứng ghi thành công, không lấy thời điểm tạo tài liệu
này làm ngày bắt đầu thu thập. Hiện tài liệu này chưa xác nhận mốc production.
