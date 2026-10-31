# Spec Delta

## ADDED Requirements

### Requirement: Lịch sử giao dịch của người dùng trên Web Admin
Hệ thống SHALL cung cấp API và giao diện cho phép Quản trị viên xem lịch sử giao dịch chi tiết của từng người dùng cụ thể. API MUST yêu cầu xác thực bằng Access Token của tài khoản có vai trò `ADMIN`. Hệ thống MUST hỗ trợ lọc giao dịch theo các khoảng thời gian chuẩn (`period`: `day`, `week`, `month`) hoặc khoảng ngày tùy chọn (`start_date`, `end_date`), tìm kiếm theo từ khóa (`keyword`) và phân trang (`page`, `limit`). Dữ liệu trả về MUST bao gồm đầy đủ số điện thoại của đối tác mà không che dấu để phục vụ công tác đối soát.

#### Scenario: Quản trị viên lấy danh sách giao dịch của người dùng thành công
- **WHEN** Quản trị viên gửi yêu cầu `GET /api/v2/admin/user/:id/transactions` với token Admin hợp lệ
- **THEN** Hệ thống trả về mã trạng thái 200 kèm danh sách các giao dịch có liên quan đến người dùng (người gửi hoặc người nhận) được sắp xếp theo thời gian mới nhất trước

#### Scenario: Lọc giao dịch theo khoảng thời gian chuẩn
- **WHEN** Quản trị viên truyền tham số `period=week`
- **THEN** Hệ thống chỉ trả về các giao dịch phát sinh từ đầu tuần hiện tại đến thời điểm hiện tại

#### Scenario: Lọc giao dịch theo khoảng ngày tùy chọn
- **WHEN** Quản trị viên truyền tham số `start_date=2026-10-01` và `end_date=2026-10-21`
- **THEN** Hệ thống chỉ trả về các giao dịch phát sinh trong khoảng thời gian từ `2026-10-01 00:00:00` đến `2026-10-21 23:59:59`

#### Scenario: Tìm kiếm giao dịch theo từ khóa
- **WHEN** Quản trị viên truyền tham số `keyword=Vietcombank` hoặc số điện thoại đối tác
- **THEN** Bảng kết quả chỉ chứa các giao dịch có tên ngân hàng, nội dung hoặc thông tin đối tác khớp với từ khóa tìm kiếm

#### Scenario: Truy vấn giao dịch của người dùng không tồn tại
- **WHEN** Quản trị viên gửi yêu cầu với một `id` người dùng không tồn tại trong hệ thống
- **THEN** Hệ thống trả về mã lỗi 404 với thông báo "Không tìm thấy người dùng"

#### Scenario: Người dùng không có quyền quản trị viên cố gắng truy cập
- **WHEN** Một tài khoản có vai trò `USER` gửi yêu cầu đến `GET /api/v2/admin/user/:id/transactions`
- **THEN** Hệ thống từ chối truy cập và trả về mã lỗi 403 Forbidden
