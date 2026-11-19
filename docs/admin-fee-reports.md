# API báo cáo phí Merchant

## Báo cáo tổng hợp tài chính và vận hành

`financialReport.repository.js` nhận client PostgreSQL của bên gọi và tổng hợp trực tiếp bảng gốc. Endpoint xuất dùng `financialReport.service.readSnapshot`: một transaction REPEATABLE READ READ ONLY cho phần tài chính, kỳ trước, tài khoản và tăng trưởng giao dịch; COMMIT/ROLLBACK và giải phóng client trước bước render workbook. Không sửa rollup trong transaction đọc này. Đây là báo cáo quản trị từ dữ liệu hệ thống, không phải bộ báo cáo tài chính pháp định hay xác nhận quyết toán ngân hàng.

| Khối | Nguồn / mốc thời gian | Phạm vi |
|---|---|---|
| Nạp, rút, chuyển tiền, thanh toán | transactions.created_at | Toàn hệ thống; phân biệt mọi trạng thái với SUCCESS/COMPLETED |
| Phí toàn hệ thống | fee_ledger_entries.created_at | Tất cả nhóm phí hợp lệ; không lọc Merchant/loại/role |
| Phí/giá trị/số giao dịch Merchant | Sổ cái QR_FEE / transactions | Theo Merchant và PAYMENT/TRANSFER đã áp dụng |
| Gateway | payment_requests.created_at, order_id khác null | Theo Merchant, không theo loại giao dịch |
| Tài khoản cuối kỳ / đăng ký | users.created_at diễn giải giờ Việt Nam | USER/MERCHANT theo role |
| Tăng trưởng giao dịch | transactions.created_at | Theo Merchant/loại; không theo role |
| Đăng nhập | Sự kiện MongoDB | Toàn hệ thống theo ngày |

Chênh lệch nạp − rút chỉ bằng TOPUP thành công trừ WITHDRAW thành công; không cộng chuyển nội bộ/thanh toán, không diễn giải là lợi nhuận hoặc biến động số dư toàn hệ thống. Số phát sinh tính mọi trạng thái, số thành công chỉ SUCCESS/COMPLETED. Trạng thái khác được giữ trong nhóm riêng.

QR toàn hệ thống và QR theo bộ lọc Merchant là hai phạm vi khác nhau. Tổng phí gồm QR PAYMENT/TRANSFER, USER_FEE, WITHDRAW_FEE, MONTHLY_PLAN_FEE, POSTPAID_SERVICE_FEE và POSTPAID_LATE_FEE; loại mới được giữ bằng mã nguồn để đối soát. Phí gói đã ghi sổ không có transaction vẫn được tính; phí gắn transaction chưa hoàn tất hoặc QR không gắn giao dịch Merchant hợp lệ nằm trong ngoại lệ, không tự đưa vào thực thu. Phí Ví trả sau chỉ lấy sổ cái thực thu, không lấy khoản phí mới ghi nợ. Không cộng số dư ví phí hay snapshot phí lần nữa.

Ngày dùng khoảng nửa mở theo Asia/Ho_Chi_Minh, bao trọn ngày cuối. Bucket hỗ trợ ngày/tuần/tháng/quý/năm, chỉ cộng phần giao kỳ và giữ mốc 0. Kỳ trước liền kề cùng số ngày, cùng phạm vi; kỳ trước bằng 0 thì mức tăng tương đối không xác định. Giao dịch và sổ cái có thể ở hai kỳ khác nhau, phải đối soát theo đúng mốc của chỉ tiêu.

Các tổng tiền/count giữ số nguyên trước chuyển đổi. Giá trị hoặc tổng vượt 999.999.999.999.999 bị từ chối bằng HTTP 422, mã EXPORT_AMOUNT_PRECISION_EXCEEDED để tránh mất chính xác trong Excel. Không trả tiền dạng chuỗi định dạng thay cho ô số.

`financial_snapshot_at` ghi thời điểm snapshot PostgreSQL; giao dịch commit sau snapshot không được ghép vào bất kỳ bảng tài chính nào trong cùng báo cáo. `generated_at` sẽ mô tả lúc tạo file và là trường riêng. Thời điểm snapshot không khẳng định đã chốt sổ cuối ngày hoặc bao gồm sự kiện tới muộn. MongoDB có thời điểm bắt đầu/kết thúc đọc riêng; lỗi login được ghi không khả dụng, không chuyển thành 0 và không tuyên bố snapshot xuyên hai DB.

Kiểm thử nền dữ liệu: đặt NODE_ENV=test và chạy `node --test tests/admin_financial_report.test.js`. Kiểm thử tạo database merchant_test_* tách biệt, bao gồm dòng tiền, phí nhiều nguồn/phí gói không transaction, loại phí mới, kỳ trước, boundary Việt Nam, các cách nhóm, số tiền lớn và một kết nối khác commit dữ liệu giữa các truy vấn snapshot.

Tất cả endpoint dưới `/api/v2/admin/reports` yêu cầu Access Token ADMIN và phiên Admin hiện hành. Thiếu phiên trả 401, sai quyền 403, bộ lọc sai 400.

- GET `/overview`, `/timeseries`, `/breakdown`, `/payment-requests`: trả cùng một bản tổng hợp nhất quán gồm overview, breakdown, timeseries, merchants, gateway, period, filters, pagination. Frontend chỉ cần gọi overview, không tải từng giao dịch.
- GET `/growth`: đăng ký USER/MERCHANT, tổng đến cuối kỳ, số và giá trị giao dịch thành công, so kỳ trước cùng độ dài. Kỳ trước 0 trả growth_percent=null.
- GET `/logins`: tái sử dụng thống kê sự kiện Mobile App trong MongoDB theo khoảng ngày; tổng lượt và User duy nhất toàn hệ thống. MongoDB chưa kết nối trả 503, không coi là kỳ có 0 lượt. Backend cần `MONGODB_URI` khi chạy ứng dụng. Kiểm thử riêng dùng `MERCHANT_TEST_MONGO_URI=mongodb://localhost:27017` và database tạm, không đổi cấu hình DB ứng dụng.
- GET `/export`: workbook 9 sheet, toàn bộ Merchant phù hợp bộ lọc, không phụ thuộc page/limit/scope; vẫn kiểm tra hợp lệ các tham số này. Có các phần toàn hệ thống theo ma trận bên trên. Không có token/credentials.

Bộ lọc: `start_date`, `end_date` dạng YYYY-MM-DD; mặc định đầu tháng tới hôm nay Việt Nam. `group_by`: day (mặc định), week (thứ Hai), month, quarter, year. `merchant_id`: UUID Merchant hoặc bỏ trống. `transaction_type`: ALL/PAYMENT/TRANSFER. `page` bắt đầu 1, `limit` 1–100 mặc định 20. Growth thêm `role` ALL/USER/MERCHANT cho thống kê tài khoản.

Thời gian dùng Asia/Ho_Chi_Minh và khoảng nửa mở từ 00:00 ngày đầu đến 00:00 ngày sau ngày cuối. Phí lọc ledger.created_at; giá trị/số giao dịch lọc transactions.created_at. Hai tập được tổng hợp riêng rồi ghép, không nhân đôi bởi nhiều fee_type. Trạng thái thành công hỗ trợ SUCCESS và giá trị legacy COMPLETED; Gateway hỗ trợ legacy PAID tương đương SUCCESS. Gateway là cohort yêu cầu có order_id theo ngày tạo; bộ lọc loại giao dịch không đổi cohort này vì request chưa thanh toán không có transaction_type. Tỷ lệ SUCCESS/(SUCCESS+EXPIRED+FAILED+CANCELLED), mẫu số 0 => null. Mốc thời gian trống có số 0.

Growth giao dịch thống kê giao dịch thành công toàn hệ thống nếu không lọc Merchant/loại; lọc role áp dụng tài khoản đăng ký. `users.created_at` là timestamp không timezone trong schema hiện tại, diễn giải theo giờ Việt Nam như cấu hình database; không ép ngầm theo timezone của tiến trình Node.

Dashboard dùng API overview và hiển thị doanh thu phí tách biệt năm KPI dòng tiền. API login hiện có được tái sử dụng cho Mobile App theo cùng khoảng ngày; đăng nhập không phải KPI theo Merchant.

Kiểm chứng: `NODE_ENV=test node --test tests/admin_fee_reports.test.js` tạo DB tách biệt, so SQL trực tiếp, thử ranh giới cuối ngày/đầu tháng, dữ liệu 107 Merchant, phân trang và đọc lại Excel. Test EXPLAIN ANALYZE chỉ chứng minh truy vấn hoạt động trên tập thử; không tuyên bố SLA trên dữ liệu production. Không thêm index trùng: cần đánh giá catalog/EXPLAIN thực tế khi triển khai với khối lượng lớn.

## BREAKING: workbook bốn sheet chuyển thành chín sheet

Endpoint và MIME XLSX giữ nguyên, JSON các endpoint đọc giữ nguyên. Tên sheet, vị trí ô và nhãn cột trong Excel thay đổi; công cụ đọc `Tong hop!B7` hoặc sheet `Merchant` phải cập nhật. Không có sheet ẩn tương thích bố cục cũ.

| Sheet mới | Nội dung chính |
|---|---|
| 01_Tong_quan | Sáu KPI, bảng phí kỳ này/kỳ trước/chênh lệch/tăng trưởng/tỷ trọng, biểu đồ xu hướng và top 10, chất lượng nguồn |
| 02_Dong_tien | Nghiệp vụ, số phát sinh/thành công/chờ/thất bại/khác, giá trị thành công, nạp trừ rút, kỳ trước |
| 03_Doanh_thu_phi | Phí thực thu theo nhóm, kỳ so sánh, ngoại lệ sổ cái |
| 04_Theo_thoi_gian | Chuỗi toàn hệ thống và Merchant riêng; phí PAYMENT/TRANSFER, giá trị, số giao dịch |
| 05_Merchant | STT, UUID đầy đủ, tên, số giao dịch, giá trị, phí, tỷ lệ phí, tỷ trọng; phí giảm dần rồi UUID |
| 06_Cong_thanh_toan | Cohort có order_id, các trạng thái, mẫu số đã kết thúc và tỷ lệ thành công |
| 07_Van_hanh | Tài khoản theo role, giao dịch theo Merchant/loại, login toàn hệ thống |
| 08_Doi_soat | Phép kiểm, phạm vi, nguồn gốc, đối chiếu, chênh lệch, trạng thái |
| 09_Thuyet_minh | Người/mã xuất, snapshot, thời điểm nguồn, định nghĩa, ma trận phạm vi, giới hạn |

Tiền/count là ô số; tiền có dấu phân nhóm và ₫. Ngày bucket là Date, định dạng dd/mm/yyyy; timestamp có timezone. Tỷ lệ lưu phân số, định dạng 0.0000%; mẫu số 0 ghi Chưa đủ dữ liệu. Hàng tổng dùng SUM với cached result, chỉ cộng chỉ tiêu có thể cộng; tổng không đổi theo bộ lọc người nhận thao tác trong Excel. UUID/tên là plain text kể cả khi bắt đầu bằng `=`, `+`, `-`, `@`.

Khổ A4 ngang, vùng in theo dữ liệu, bảng Merchant lặp header và nhiều trang dọc. Tổng quan có sáu thẻ KPI và hai ảnh PNG; ngắt trang trước biểu đồ, không ép Merchant vào một trang. Biểu đồ lấy từ toàn tập theo bộ lọc, không lấy riêng trang UI. Ảnh không tự cập nhật khi người nhận sửa ô. Font nội dung Calibri, biểu đồ Arial/sans-serif có tiếng Việt; dựng SVG/PNG tại server, không gọi dịch vụ ảnh bên ngoài.

## Từ điển đối soát

`Chênh lệch = giá trị đối chiếu − giá trị gốc`. Khớp khi bằng 0; khác 0 là Cần kiểm tra và giữ nguyên số nguồn. Không khả dụng chỉ áp dụng nguồn phụ thiếu, không biến phần tài chính thiếu bảng/query lỗi thành số 0.

| Phép kiểm | Nguồn gốc → đối chiếu | Đơn vị/phạm vi |
|---|---|---|
| Tổng phí theo nguồn / thời gian | Scalar ledger hợp lệ → nhóm phí / chuỗi hệ thống | VND, toàn hệ thống |
| QR PAYMENT + TRANSFER / theo thời gian | Scalar QR hợp lệ → hai nhóm QR / chuỗi QR | VND, toàn hệ thống |
| Phí/Giá trị/Số giao dịch theo Merchant, thời gian, loại | Overview cùng bộ lọc → tổng từng chiều | VND hoặc giao dịch, Merchant theo bộ lọc |
| Nạp trừ rút theo thời gian | Nghiệp vụ thành công → chuỗi nạp trừ rút | VND, toàn hệ thống |
| Số giao dịch theo nghiệp vụ | Scalar count giao dịch → tổng các loại | Giao dịch, toàn hệ thống |
| Trạng thái từng nghiệp vụ | Tổng nghiệp vụ → thành công/chờ/thất bại/khác | Giao dịch, toàn hệ thống |
| Trạng thái yêu cầu thanh toán | Tổng request → các trạng thái đã biết | Yêu cầu, Merchant; không lọc loại |
| Phí không đủ điều kiện / trạng thái khác | 0 kỳ vọng → ngoại lệ quan sát được | VND/bút toán/giao dịch |
| Nguồn đăng nhập App | Availability MongoDB | Không khả dụng khi lỗi |

Các phép tính nguồn và nhóm được tổng hợp riêng trong cùng snapshot PostgreSQL. Ngoại lệ ledger kể cả tổng tiền bằng 0 vẫn cảnh báo theo số bút toán. Phạm vi khác nhau không so trực tiếp; phí QR theo Merchant có thể nhỏ hơn QR toàn hệ thống. Đây là đối soát nội bộ, không xác nhận ngân hàng đã quyết toán.

## Export, audit và xử lý lỗi

Ví dụ: `GET /api/v2/admin/reports/export?start_date=2026-11-01&end_date=2026-11-18&group_by=day&role=MERCHANT&page=2&limit=20` với phiên ADMIN. File `Bao_cao_tai_chinh_vi_dien_tu_20261101_20261118.xlsx`, MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Cache-Control: no-store`.

Người xuất lấy từ `req.user.user_id` và tên trong PostgreSQL; `admin_name` do client gửi không được dùng. `financial_snapshot_at` là thời điểm snapshot tài chính; `generated_at` là lúc tạo báo cáo. Đọc MongoDB có timestamp riêng. `ADMIN_FINANCIAL_REPORT_GENERATED` được ghi vào PostgreSQL audit_outbox sau render thành công, trước gửi bytes. Payload có report_id, admin_id, kỳ/phạm vi chuẩn hóa, snapshot, generated, phiên bản workbook, số Merchant, availability và đối soát; không chứa workbook, secret, token, session hay PII khách. Sự kiện không chứng minh thiết bị đã tải xong.

401/403: phiên/quyền; 400: bộ lọc không hợp lệ; 422 `EXPORT_AMOUNT_PRECISION_EXCEEDED`: tiền/count vượt 15 chữ số. Query tài chính, render ảnh/XLSX hoặc ghi audit thất bại thì request lỗi và không gửi file thành công. MongoDB lỗi vẫn xuất đủ 9 sheet với cảnh báo Không khả dụng. Worksheet vượt giới hạn dòng bị từ chối rõ, không cắt dữ liệu.

## Thao tác Web Admin

Áp dụng kỳ ngày trước khi xuất. Merchant/loại tải lại overview và growth; nhóm thời gian chỉ overview; role chỉ growth; ngày tải tất cả; phân trang chỉ lấy danh sách Merchant. Các chỉ tiêu cuối bảng ghi Tổng phí trang hiện tại/Tổng giá trị trang hiện tại; file xuất vẫn lấy toàn tập. Export hợp nhất role đã tải thành công với kỳ/phạm vi báo cáo đã áp dụng, không dùng ngày chọn dở trong hộp thoại. Nút xuất khóa khi các phạm vi đang tải hoặc chưa đồng bộ; phản hồi cũ không ghi đè bộ lọc mới. Lỗi role giữ bộ lọc áp dụng trước đó; lỗi login vẫn cho xuất có cảnh báo nguồn.

## Runtime, triển khai và rollback

Dependency `sharp` được ghim qua package-lock. Cài bằng `npm ci` trên đúng OS/kiến trúc triển khai và giữ optional dependencies cho native binary; không sao chép node_modules Windows sang Linux. Máy kiểm thử dùng Node 26.12.1 win32/x64, Sharp SVG → PNG hoạt động và tiếng Việt đã xuất thành ảnh offline. Runtime cần font Arial hoặc font sans-serif hỗ trợ tiếng Việt (ví dụ DejaVu Sans trên Linux) và cache fontconfig ghi được bởi tài khoản dịch vụ. Sandbox kiểm thử có cảnh báo thư mục cache ngoài workspace không ghi được, nhưng ảnh vẫn tạo; không sửa quyền toàn hệ thống để né cảnh báo.

Backend triển khai trước: chạy `npm ci`, smoke `node --test tests/report_charts.test.js`, kiểm tra endpoint bằng phiên ADMIN và mở XLSX mẫu. Client cũ vẫn gọi cùng route/query, có thể giữ tên tải cũ. Sau đó build/triển khai Web Admin; kiểm tra role, ngày, Merchant/type và tên file. Nếu runtime đích khác máy này, phải chạy smoke font/native và bản in tại runtime đó trước phát hành.

Rollback bằng artifact Backend/Web Admin phiên bản trước, không xóa audit_outbox đã ghi. Change không có migration nghiệp vụ, không sửa dữ liệu tiền hoặc số dư; không thêm index khi chưa có EXPLAIN chứng minh cần. Hướng dẫn này không đồng nghĩa đã triển khai production. Bằng chứng và phần nghiệm thu còn thiếu được ghi trong `financial-report-verification.md`.

Tái tạo mẫu: đặt `NODE_ENV=test`, chạy `node scripts/verify_financial_report.js`; script tạo DB merchant_test_* mới và dọn sau chạy. `scripts/preview_financial_report.ps1` dùng Excel ẩn/read-only xuất PDF; `scripts/render_report_preview.ps1` dùng Windows PDF renderer tạo PNG để kiểm tra bản in. Các file trong `docs/samples` là dữ liệu giả lập, không chứa dữ liệu khách thật.
