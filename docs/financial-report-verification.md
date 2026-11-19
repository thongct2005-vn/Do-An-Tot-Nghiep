# Biên bản kiểm chứng: thiet-ke-bao-cao-excel

Ngày 18/11/2026. Môi trường Windows local được người dùng chọn; PostgreSQL/MongoDB kiểm thử dùng database mới tách biệt. Không triển khai production và không sửa bảng tiền của hệ thống đang dùng.

## Kết quả chức năng

- Workbook có đủ chín sheet theo thứ tự thiết kế, sáu KPI, phí hệ thống/QR Merchant riêng, dòng tiền và kỳ trước, chuỗi thời gian, toàn tập Merchant, gateway, vận hành, đối soát và thuyết minh.
- Snapshot PostgreSQL REPEATABLE READ READ ONLY giữ cùng số liệu dù kết nối thứ hai commit giao dịch giữa các truy vấn. Client được giải phóng trước render; query/render/audit lỗi không trả file thành công.
- MongoDB lỗi được thể hiện Không khả dụng; unique toàn kỳ được kiểm chứng với một người đăng nhập nhiều ngày. Không cộng unique từng ngày.
- Đọc lại XLSX kiểm chứng ô số, ngày, UUID, cached SUM, nhãn bắt đầu bằng công thức vẫn là text; chính xác tiền/count tối đa 15 chữ số. Vượt ngưỡng trả 422.
- Request page=2/limit=20 vẫn xuất đủ 107 Merchant. Tỷ lệ gateway 999.998/1.000.000 giữ giá trị 0,999998, không làm tròn thành tỷ lệ tuyệt đối 100% trong dữ liệu ô.
- UI giữ role/kỳ đã áp dụng thành công, từ chối phản hồi cũ, không áp ngày đã hủy, khóa xuất khi phạm vi chưa đồng bộ và giữ khả năng xuất khi login lỗi. Tên tải lấy từ kỳ gửi request.

## Bằng chứng mẫu và bản in Excel

[Mẫu theo tổng số trong ảnh](samples/bao-cao-mau-theo-anh.xlsx) chứa 107 Merchant giả lập: phí 108.524.658 ₫, giá trị 11.806.391.000 ₫, 39.772 giao dịch. SQL → API → XLSX được assert trong `scripts/verify_financial_report.js`. Phân bổ theo Merchant/ngày/loại là dữ liệu tổng hợp phục vụ kiểm thử, không sao chép giao dịch thật từ ảnh.

[Mẫu thêm phí hệ thống](samples/bao-cao-mau-them-phi-he-thong.xlsx) có 800.000 ₫ phí USER/POSTPAID/MONTHLY thêm vào, tổng phí hệ thống 109.324.658 ₫; phí Merchant vẫn 108.524.658 ₫. Mẫu này dùng kỳ 01/01–18/11/2026 để kiểm chứng 322 bucket ngày.

Excel thực tế được mở qua COM ở chế độ ẩn/read-only, xuất từng sheet thành PDF; Windows PDF renderer tạo PNG để xem bản in. Đã kiểm tra tiếng Việt, title/KPI, bảng, UUID đầy đủ, hàng tổng, ảnh không bị chia đôi/đè bảng và header Merchant lặp. Workbook đặt paperSize=9 (A4), landscape. Bản PDF cuối xác nhận MediaBox 841,92 × 595,32 point (A4 ngang), tắt ánh xạ A4 sang Letter trong lúc preview. Tổng quan giữ 2 trang; số trang từng sheet được ghi chính xác trong print-pages.json.

Xem [trang đầu Tổng quan](samples/01_Tong_quan-1.png), [biểu đồ và chất lượng nguồn](samples/01_Tong_quan-2.png), [trang cuối Merchant](samples/05_Merchant-5.png), [đối soát](samples/08_Doi_soat-1.png). Các PDF/PNG còn lại cùng thư mục; [excel-preview.json](samples/excel-preview.json) và [print-pages.json](samples/print-pages.json) ghi vùng in/số trang.

## Kiểm thử tự động

- Bộ bắt buộc báo cáo, snapshot, Hybrid Rollup, login, audit, Dashboard, xuất chi tiết và ảnh: 44 test đạt. Runner `NODE_ENV=test node scripts/test_financial_report.js` cấp database tách biệt cả cho unit test import global pool; kết quả trong [backend-tests.log](samples/backend-tests.log).
- `flutter test test/fee_reports_ui_test.dart`: 6 test đạt, gồm viewport 1024/1366/1600, role trả muộn, ngày draft bị hủy, tên file và login lỗi.
- Dart analyze hai file thay đổi: No issues found. `flutter build web --release --no-pub`: thành công. Cảnh báo dry-run Wasm do helper `dart:html` có sẵn; bản phát hành kiểm chứng là JavaScript web.
- Kiểm thử mở rộng `merchant_fee_flow.test.js`: ca đối chiếu SQL → Dashboard → report → Excel đạt; 10 ca nền thu phí thất bại, cộng parent suite thành 11 kết quả fail. Nguyên nhân gồm fixture thiếu `merchant_fee_amount_snapshot`, điều kiện KYC và kỳ vọng cấu hình phí cũ. Nạp lại service/route/test nguyên bản commit `9675112` bằng `legacy_fee_baseline_hook.js` tái hiện cùng 10 ca lỗi, trong khi ca báo cáo vẫn đạt. Đây không phải kết quả toàn repo xanh. Xem [log mở rộng](samples/backend-extended-tests.log), [log đối chiếu bản trước](samples/legacy-fee-baseline.log); không sửa logic thu phí/KYC ngoài phạm vi change này.

## Hiệu năng quan sát

[verification.json](samples/verification.json) lưu EXPLAIN ANALYZE/BUFFERS của truy vấn báo cáo cũ và toàn bộ truy vấn đọc thực tế của exporter mới, catalog index, thời gian và RSS. Fixture: 39.772 giao dịch, 107 Merchant, kỳ 322 ngày. Lần đo cuối export 8.475 ms; RSS trước 115.609.600 byte, sau 143.400.960 byte (chênh 27.791.360 byte); XLSX 105.831 byte. Các lần chạy local trước đó dao động khoảng 0,7–1,9 giây; đây là phép đo có biến động, chưa phải benchmark kiểm soát tải.

Các query trả aggregate: metadata 1 dòng, Merchant full JSON 1 dòng chứa toàn tập, chuỗi 322 bucket, nhóm phí/nghiệp vụ/tài khoản và scalar. Không tải 39.772 transaction chi tiết sang Node. Thời gian từng query và từng plan nằm trong JSON bằng chứng. Không thêm index: catalog/plan chưa chứng minh cần một index mới cho quy mô này. RSS trước/sau không phải peak; số đo local chịu tải đồng thời và không phải SLA hoặc dự báo production.

## Triển khai và rollback local

[local-rollout.json](samples/local-rollout.json) ghi kiểm chứng HTTP với phiên ADMIN thật trên database thử. Host chỉ mount phân hệ báo cáo và phục vụ artifact Flutter; không khởi động background jobs hay triển khai toàn hệ thống.

1. Nạp route/service báo cáo commit `9675112` và artifact Web Admin có sẵn ngày 13/11: xuất 4 sheet.
2. Khởi động host Backend mới, giữ nguyên artifact Web Admin cũ: cùng endpoint/query xuất 9 sheet.
3. Khởi động host với Backend mới và artifact `flutter build web` mới: xuất 9 sheet; SHA256 file main.dart.js HTTP trùng artifact mới.
4. Quay lại route/service và frontend cũ: xuất lại 4 sheet; audit mới vẫn còn 2 sự kiện, tổng tiền giao dịch/sổ cái và số dư người dùng không đổi.

Native Sharp và font tiếng Việt đã chạy trong chính host Windows này. Không cần migration tiền hoặc rollback dữ liệu. Bản frontend cũ nằm ở `web-admin/build/report-release-before`; snapshot hai file Backend cũ ở `web-admin/build/report-backend-before`. Các host local được đóng và database thử được dọn sau nghiệm thu; source/build mới vẫn giữ trong workspace. Có thể tái chạy `NODE_ENV=test node scripts/verify_report_rollout.js` khi hai artifact còn tồn tại.

Trước một đợt phát hành thật trên OS/kiến trúc khác, cần chạy lại npm ci, smoke native/font và kiểm tra bản in theo hướng dẫn [admin-fee-reports.md](admin-fee-reports.md). Biên bản này chỉ xác nhận phạm vi local đã thực hiện.
