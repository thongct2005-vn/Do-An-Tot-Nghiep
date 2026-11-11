# API quản trị Merchant — GĐ1.1

`GET /api/v2/admin/merchants` trả `{status, code, message, data: {stats, items, pagination}}`.
`GET /api/v2/admin/merchants/:id` trả thông tin chi tiết. Cả hai yêu cầu Bearer access token ADMIN và phiên hiện tại còn hiệu lực.

## KPI và tab

Chỉ đếm `users.role = 'MERCHANT'`. KPI toàn hệ thống, không bị ảnh hưởng bởi tìm kiếm, bộ lọc hoặc phân trang.

| KPI | Tab | Điều kiện |
| --- | --- | --- |
| total_merchants | ALL | Tất cả Merchant |
| linked_merchants | LINKED | ACTIVE, API Key và Secret Key khác NULL, callback khác NULL và TRIM khác chuỗi rỗng |
| unconfigured_merchants | UNCONFIGURED | ACTIVE, thiếu ít nhất một thành phần trên |
| suspended_merchants | SUSPENDED | BLOCKED hoặc SUSPENDED, độc lập KYC/cấu hình |
| pending_merchants | PENDING | KYC PENDING hoặc thiếu KYC, độc lập trạng thái tài khoản |

Khi chỉ lọc tab, `pagination.total_items` bằng KPI tương ứng. KYC PENDING không phải hàng chờ ADMIN phê duyệt. Một Merchant có thể thuộc cả PENDING và SUSPENDED; không cộng các KPI như các nhóm loại trừ nhau.

Ví dụ fixture kiểm thử A/B gồm 32 Merchant: total=32, linked=6, unconfigured=5, suspended=11, pending=12. Ba Merchant ACTIVE có đủ khóa nhưng callback NULL/rỗng/khoảng trắng thuộc UNCONFIGURED, trả api_status=NOT_CONNECTED. Có 5 Merchant đồng thời PENDING và SUSPENDED.

## Ba chiều trạng thái

- `approval_status`: KYC mới nhất; APPROVED/APPPROVED → APPROVED, REJECTED → REJECTED, còn lại/thiếu → PENDING.
- `operational_status`: ACTIVE → ACTIVE; BLOCKED/SUSPENDED → SUSPENDED; còn lại/NULL → UNKNOWN.
- `api_status` theo thứ tự ưu tiên: BLOCKED/SUSPENDED → LOCKED; trạng thái khác ACTIVE → NOT_CONNECTED; ACTIVE thiếu khóa → PENDING_KEY; đủ khóa thiếu callback → NOT_CONNECTED; đủ cấu hình → LINKED.

Các quy tắc trạng thái dùng chung cho danh sách và chi tiết. Không trả Secret Key. Thay đổi này mô tả dữ liệu quản trị, không đổi quy tắc thanh toán hoặc dữ liệu KYC gốc.

## Tham số danh sách

| Tham số | Giá trị hợp lệ / mặc định |
| --- | --- |
| page | Số nguyên dương an toàn; mặc định 1 |
| limit | Số nguyên 1–100; mặc định 10 |
| search | Chuỗi trim tối đa 200 ký tự; rỗng tương đương không tìm kiếm |
| tab | ALL (mặc định), LINKED, PENDING, UNCONFIGURED, SUSPENDED |
| approval_status | ALL (mặc định), APPROVED, PENDING, REJECTED |
| status | ALL (mặc định), ACTIVE, SUSPENDED, UNKNOWN; alias BLOCKED, PENDING_ACTIVATION, DISABLED |
| api_status | ALL (mặc định), LINKED, PENDING_KEY, NOT_CONNECTED, LOCKED |
| period | ALL (mặc định), TODAY, THIS_WEEK, THIS_MONTH; alias DAY, WEEK, MONTH |
| start_date / end_date | Ngày lịch có thật YYYY-MM-DD, năm từ 0001; có thể chỉ gửi một đầu mốc |

Enum được trim và chuyển chữ hoa. Chỉ áp dụng mặc định khi tham số vắng mặt; số/enum/ngày đã gửi nhưng rỗng, sai kiểu (kể cả lặp query parameter thành mảng) hoặc sai giá trị trả 400. Offset `(page-1)*limit` phải là số nguyên an toàn.

`status=ACTIVE` chỉ xét users.status, độc lập KYC. `BLOCKED` là alias SUSPENDED (bao gồm BLOCKED và SUSPENDED). Alias chuyển tiếp `PENDING_ACTIVATION` lọc KYC PENDING, `DISABLED` lọc KYC REJECTED; không thay đổi operational_status trả về.

Tìm kiếm chuỗi con theo tên cửa hàng, điện thoại, email, mã số thuế KYC mới nhất, UUID và mã MER-xxxxx; kết hợp tất cả bộ lọc bằng AND. Các ký tự `%` và `_` giữ ngữ nghĩa wildcard LIKE hiện có. Giá trị tìm kiếm được truyền bằng tham số SQL.

Khoảng ngày là `[start, end)` theo **Asia/Ho_Chi_Minh**, phù hợp users.created_at kiểu timestamp without time zone. end_date được đổi thành đầu ngày kế tiếp để bao gồm toàn bộ ngày đã chọn. TODAY là trọn ngày; tuần từ thứ Hai tới trước thứ Hai tiếp theo; tháng từ ngày 1 tới trước ngày 1 tháng sau. Nếu có start_date hoặc end_date thì ưu tiên ngày tường minh, nhưng period vẫn được kiểm tra hợp lệ. start_date lớn hơn end_date trả 400.

Thứ tự cố định `created_at DESC, id DESC`. KPI, count và items được đọc bằng cùng transaction `REPEATABLE READ READ ONLY`; request khác có thể thấy snapshot mới. Trang vượt dữ liệu trả 200 với items rỗng, current_page giữ trang yêu cầu; total_items/total_pages theo tập sau lọc, không theo trang. Nếu không có kết quả thì total_pages=0.

Ví dụ `?search=fixture%20store&tab=LINKED&status=ACTIVE&approval_status=APPROVED&api_status=LINKED&limit=1&page=2` trên fixture tích hợp có 2 kết quả phù hợp: total_items=2, total_pages=2, current_page=2, một item; stats vẫn đếm toàn bộ 36 Merchant.

Ví dụ lỗi `?limit=101` trả HTTP 400:

```json
{"status":"error","code":400,"message":"Tham số limit không hợp lệ"}
```

Chi tiết với UUID sai trả 400; UUID hợp lệ nhưng không phải Merchant/không tồn tại trả 404. Thiếu/sai/hết hạn token hoặc phiên bị thay thế trả 401; sai role hoặc ADMIN bị khóa trả 403.

## Chạy kiểm thử

Trong thư mục backend (PowerShell):

```powershell
node --test tests/admin_merchants_query.test.js
$env:NODE_ENV='test'
$env:MERCHANT_INTEGRATION_TEST='1'
node --test tests/admin_merchants_integration.test.js
```

Integration test dùng tọa độ kết nối PostgreSQL từ .env nhưng tạo database mới `merchant_test_<id>` qua database bảo trì postgres. Cần quyền CREATEDB. Không chèn fixture vào database ứng dụng; từ chối target trùng DB_NAME, tên ngoài allowlist, chế độ khác test hoặc database đã tồn tại. Bộ test tạo signing secret riêng, dùng JWT và phiên ADMIN fixture thật qua router/middleware/repository; không chạy luồng email/OTP đăng nhập. Database tạm được xóa sau chạy và xác nhận đã biến mất.

Schema test là tập con các cột đọc/ghi cần cho kiểm thử Merchant và các luồng ghi email. Fixture có unique phone, giới hạn tên/email và CHECK constraint action audit; không phải bản sao đầy đủ schema hay migration production. Các bảng phụ cho chi tiết được tạo thật, không stub SQL. Các kiểm thử này không đánh giá hiệu năng trên dữ liệu production hoặc quy trình đăng nhập/triển khai trình duyệt thực tế.

## GĐ2.2 — Cập nhật hồ sơ Merchant

`PATCH /api/v2/admin/merchants/:id/profile`

Yêu cầu `Authorization: Bearer <ADMIN access token>` và `Content-Type: application/json`. ADMIN phải ACTIVE và token phải thuộc phiên đăng nhập hiện tại. `:id` là UUID của user có role MERCHANT.

| Trường body | Quy tắc |
| --- | --- |
| full_name | Tùy chọn; chuỗi trim từ 2–50 ký tự |
| store_name | Alias của full_name; nếu gửi cả hai thì phải giống nhau sau trim |
| phone | Tùy chọn; chuỗi trim khớp `^(03\|05\|07\|08\|09)\d{8}$`, duy nhất trên users |
| email | Tùy chọn; chuỗi trim, lowercase, đúng định dạng, tối đa 100 ký tự; duy nhất không phân biệt hoa/thường trên users |
| call_back_url | Tùy chọn; chuỗi trim tối đa 500 ký tự; null/rỗng để xóa |
| reason | Bắt buộc; chuỗi trim từ 5–500 ký tự |

Phải có ít nhất một trường hồ sơ thay đổi thực tế sau chuẩn hóa. Giá trị không được ép kiểu; email/phone không nhận null hoặc rỗng. Field lạ hoặc được bảo vệ (status, role, balance, address/KYC, credentials, password/PIN/TOTP, token...) bị từ chối toàn bộ request. Validation dùng dữ liệu gốc trước bước sanitize chung để không tự sửa một email/số điện thoại sai thành hợp lệ.

Callback production bắt buộc HTTPS, không chứa user/password, không trỏ localhost/IP nội bộ, và DNS phải phân giải ra IP công khai. `ALLOW_PRIVATE_CALLBACKS=true` chỉ được áp dụng cho endpoint này khi không chạy production. Xóa callback không thu hồi session; metadata trạng thái tích hợp trong API GET hiện có sẽ phản ánh cấu hình mới.

Ví dụ body:

```json
{
  "store_name": "DigiMart Hà Nội",
  "email": "contact@digimart.vn",
  "reason": "Cập nhật theo hồ sơ doanh nghiệp đã xác nhận"
}
```

Ví dụ response 200 (ID/thời gian minh họa):

```json
{
  "status": "success",
  "code": 200,
  "message": "Cập nhật hồ sơ merchant thành công",
  "data": {
    "merchant": {
      "id": "10000000-0000-4000-8000-000000000010",
      "full_name": "DigiMart Hà Nội",
      "store_name": "DigiMart Hà Nội",
      "phone": "0912345678",
      "email": "contact@digimart.vn",
      "call_back_url": null,
      "updated_at": "2026-11-11T05:00:00.000Z"
    },
    "audit": {
      "id": "20000000-0000-4000-8000-000000000001",
      "action": "USER_PROFILE_UPDATED",
      "reason": "Cập nhật theo hồ sơ doanh nghiệp đã xác nhận",
      "created_at": "2026-11-11T05:00:00.000Z"
    }
  }
}
```

| HTTP | Ý nghĩa |
| --- | --- |
| 400 | UUID/body sai, field ngoài allowlist, tên/phone/email/callback/reason sai, alias mâu thuẫn hoặc không có thay đổi |
| 401 | Thiếu/sai/hết hạn token, thiếu sid hoặc phiên ADMIN đã bị thay thế/kết thúc |
| 403 | Sai role hoặc ADMIN bị khóa |
| 404 | UUID hợp lệ nhưng không có Merchant tương ứng |
| 409 | Email hoặc số điện thoại đã thuộc tài khoản khác, kể cả tranh chấp đồng thời |
| 503 | DNS tạm thời không kiểm tra được callback; có thể thử lại |
| 500 | Lỗi lưu hồ sơ/audit; transaction rollback |

Update và audit dùng chung transaction. `old_values`/`new_values` chỉ chứa các field hồ sơ thay đổi, alias lưu dưới `full_name`; không ghi token, hash điện thoại hay secret. Action `USER_PROFILE_UPDATED` tương thích CHECK constraint hiện có, `user_id` là Merchant mục tiêu. API trả metadata audit, không trả payload nội bộ hoặc credentials.

Khi phone/email đổi, transaction cập nhật phone_hash nếu cần, xóa refresh_token/fcm_token và phát `force_logout` sau commit. Lỗi gửi socket không làm thất bại một cập nhật đã commit. Access JWT đã cấp vẫn có thể hợp lệ đến hạn hết hạn; endpoint không triển khai blacklist JWT.

Mọi đường ghi email ứng dụng cùng dùng advisory lock theo email đã trim/lowercase, kiểm tra trùng bên trong transaction READ COMMITTED. Cơ chế áp dụng cho đăng ký USER/Merchant production/sandbox và cập nhật USER/Merchant của ADMIN. SQL từ công cụ ngoài ứng dụng không tham gia giao thức này; triển khai không thêm unique index email hay sửa schema production.

Chạy các bài kiểm tra API mới và cạnh tranh email trong database cô lập:

```powershell
$env:NODE_ENV='test'
$env:MERCHANT_INTEGRATION_TEST='1'
node --test tests/email_claim_integration.test.js tests/admin_merchants_profile.test.js
```

Các bài kiểm tra dùng HTTP/middleware thật, PostgreSQL thật và fixture user/admin. DNS được mô phỏng để kiểm tra đích riêng/công khai và lỗi phân giải; socket được quan sát ở lời gọi phát sự kiện sau commit, chưa bao gồm trình duyệt Flutter nhận sự kiện.
