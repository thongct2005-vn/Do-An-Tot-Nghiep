# Phí nền tảng Merchant — quyết định nghiệp vụ

Áp dụng theo change `ke-hoach-thu-phi-san`. Tài liệu mô tả hành vi đích; tiến độ triển khai nằm trong checklist OpenSpec.

## Tám quyết định đã chốt

1. Chiết khấu là giảm tỷ lệ phí theo bậc hóa đơn, không giảm giá cho người mua hoặc cấu hình riêng từng Merchant.
2. Chọn bậc theo một giao dịch nhận tiền, không theo doanh số tích lũy tháng.
3. Nhân tỷ lệ trên toàn hóa đơn và áp sàn ranh giới bậc trước để phí không giảm khi số tiền tăng.
4. Thu phí chiều nhận cho cả PAYMENT và TRANSFER vào Merchant; báo cáo tách riêng hai loại. Người gửi trả gốc cộng phí chiều gửi nếu có, Merchant nhận gốc trừ phí Merchant.
5. Giữ min_fee=200 VND, max_fee=null, free_threshold_amount=0, làm tròn half-up tới đồng. Phí không vượt amount. Giá trị phí 0 phải xuất phát từ cấu hình hợp lệ, không từ cấu hình thiếu.
6. Một cấu hình chung; lưu snapshot phí lúc tạo QR. Admin cập nhật có hiệu lực với QR mới; QR đang chờ giữ snapshot. Không có bảng phiên bản hay lịch áp dụng. TRANSFER trực tiếp chốt lúc thực hiện.
7. Ngoài bản đầu: hoàn tiền/đảo phí, công nợ, phí trả sau, hóa đơn dịch vụ, phí riêng Merchant.
8. Doanh thu phí Merchant lấy QR_FEE thực thu từ ledger. Không dùng giá trị thanh toán, số dư ví phí hoặc phí USER/WITHDRAW thay cho doanh thu Merchant.

## Công thức và trường hợp chuẩn

VND nguyên dương, trong giới hạn số nguyên an toàn của hệ thống. Tính tích và làm tròn bằng số nguyên: `round(A × bps / 10000) = (BigInt(A) × BigInt(bps) + 5000n) / 10000n`.

| Giá trị hóa đơn | Tỷ lệ trên toàn hóa đơn | Sàn ranh giới |
| --- | --- | --- |
| 1–200.000đ | 150 bps = 1,5% | 0đ |
| 200.001–1.000.000đ | 120 bps = 1,2% | 3.000đ |
| Từ 1.000.001đ | 100 bps = 1% | 12.000đ |

Phí = min(amount, max(phí theo tỷ lệ, sàn ranh giới, min_fee)). Nếu cấu hình có max_fee thì áp trần hợp lệ sau bước max; ngưỡng miễn phí dương chỉ miễn cho amount nhỏ hơn ngưỡng, như hợp đồng cấu hình hiện có. Mặc định không có trần/ngưỡng miễn. Với biểu phí tùy chỉnh, sàn bậc i là phí tại `from_amount[i] - 1` của bậc trước, tính đệ quy qua các bậc trước đó. Tỷ lệ 0 riêng một bậc không tự xóa sàn ranh giới hay min_fee.

| Amount (đ) | Phí (đ) | Merchant nhận (đ) |
| ---: | ---: | ---: |
| 100000 | 1500 | 98500 |
| 200000 | 3000 | 197000 |
| 200001 | 3000 | 197001 |
| 250000 | 3000 | 247000 |
| 500000 | 6000 | 494000 |
| 1000000 | 12000 | 988000 |
| 1000001 | 12000 | 988001 |
| 1200000 | 12000 | 1188000 |
| 1500000 | 15000 | 1485000 |

Kiểm chứng độc lập: `node --test tests/merchant_fee_reference.test.js`. Các kỳ doanh số tháng khác nhau không thay đổi bảng này.

## Định nghĩa báo cáo và đối chiếu scenario

| KPI / scenario admin-reports | Nguồn và quy tắc |
| --- | --- |
| Doanh thu hai nguồn / không cộng phí loại khác | SUM ledger.amount WHERE fee_type=QR_FEE; JOIN duy nhất transaction thành công PAYMENT/TRANSFER có người nhận MERCHANT; nhóm theo loại giao dịch. Lọc kỳ bằng ledger.created_at. 6000+3000=9000; không cộng USER_FEE/WITHDRAW_FEE. |
| Phí 0 / giá trị khác doanh thu | COUNT và SUM transactions.amount của PAYMENT/TRANSFER thành công vào Merchant, lọc transactions.created_at. Giao dịch 500000 phí 6000 có GMV 500000, doanh thu 6000; giao dịch phí 0 vẫn đếm. Tổng hợp độc lập với ledger để tránh mất/nhân dòng. |
| Lọc Merchant / kỳ trống / cuối ngày | Cùng Merchant, loại giao dịch, ngày cho KPI/biểu đồ/bảng/Excel. Bucket trống = 0. Ngày Việt Nam dùng [00:00 ngày đầu, 00:00 ngày sau ngày cuối), Asia/Ho_Chi_Minh; hỗ trợ day/week/month/quarter/year. |
| Gateway tỷ lệ / không nhân Request / chỉ PENDING | Cohort payment_requests có order_id, theo created_at. Đếm mỗi request một lần theo SUCCESS/PENDING/EXPIRED/FAILED/CANCELLED. Tỷ lệ = SUCCESS/(SUCCESS+EXPIRED+FAILED+CANCELLED); PENDING không vào mẫu số, mẫu số 0 => null. KPI request và transaction riêng biệt. |
| Tăng trưởng / kỳ trước 0 / tách vai trò | users.created_at: đăng ký mới trong kỳ và tổng tài khoản tới cuối kỳ; chỉ USER/MERCHANT. Transaction thành công, bỏ PENDING. Kỳ trước cùng độ dài. Growth=(current-previous)/previous; previous=0 => null kèm hai số gốc. |
| Đăng nhập nhiều lần | Tái sử dụng sự kiện Mobile App đăng nhập thành công MongoDB; tổng lượt và distinct user_id. Một User ba lượt => 3 lượt, 1 User. |
| Excel khi phân trang / quá 5000 | Excel tổng hợp Backend trên toàn tập phù hợp bộ lọc. Excel giao dịch chi tiết từ chối >5000, không cắt cụt. |
| Quyền Admin | API và màn hình yêu cầu phiên Admin hợp lệ; Excel không có credentials/token. |

Dashboard thêm thẻ doanh thu dùng cùng truy vấn reports, giữ năm KPI dòng tiền. Khi đổi kỳ phải loại phản hồi cũ đến chậm; kỳ không phí hiển thị 0đ.

## Vận hành biểu phí trên Web Admin

Vào **Cấu hình phí & chiết khấu**, đọc các mốc VND và tỷ lệ %. Chỉnh biểu phí chung, bấm **Xem trước** để kiểm tra cả chín mức tiền chuẩn; sửa thêm bất kỳ trường nào phải xem trước lại. Bấm **Lưu biểu phí**, nhập lý do 5–500 ký tự và xác nhận. Thay đổi áp dụng ngay cho QR mới và chuyển khoản mới; QR đang chờ giữ snapshot. Kiểm tra lịch sử người thao tác, lý do, trước/sau sau khi lưu. Khi lỗi tải, dùng Thử lại/Tải lại; khi lưu lỗi không coi biểu phí đã đổi, tải lại để xác nhận trạng thái Backend.

API dùng lại `/api/v2/admin/merchants/fee-config/default` (GET, PUT), `/default/preview` (POST), `/history` (GET). Mọi API yêu cầu phiên ADMIN hiện hành. PAYMENT/TRANSFER chiều nhận dùng công thức hóa đơn; WITHDRAW và phí chuyển chiều gửi giữ quy tắc cũ. Hai Admin cập nhật được tuần tự hóa bằng khóa dòng PostgreSQL; lịch sử phản ánh đúng cấu hình trước mỗi lần ghi. Không gửi credentials/token trong cấu hình hay lý do.

## Chuyển đổi dữ liệu

Không tính lại phí giao dịch thành công. QR Merchant PENDING cũ thiếu snapshot bị từ chối thanh toán với hướng dẫn tạo lại. Không cho client gán số phí. Config thiếu/sai phải rollback tạo QR, không ngầm miễn phí. Snapshot và request/items/Audit cùng transaction; thanh toán, ví, ledger, request, webhook outbox cùng transaction. Retry không thu thêm lần hai.
