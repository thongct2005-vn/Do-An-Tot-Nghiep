# API báo cáo phí Merchant

Tất cả endpoint dưới `/api/v2/admin/reports` yêu cầu Access Token ADMIN và phiên Admin hiện hành. Thiếu phiên trả 401, sai quyền 403, bộ lọc sai 400.

- GET `/overview`, `/timeseries`, `/breakdown`, `/payment-requests`: trả cùng một bản tổng hợp nhất quán gồm overview, breakdown, timeseries, merchants, gateway, period, filters, pagination. Frontend chỉ cần gọi overview, không tải từng giao dịch.
- GET `/growth`: đăng ký USER/MERCHANT, tổng đến cuối kỳ, số và giá trị giao dịch thành công, so kỳ trước cùng độ dài. Kỳ trước 0 trả growth_percent=null.
- GET `/logins`: tái sử dụng thống kê sự kiện Mobile App trong MongoDB theo khoảng ngày; tổng lượt và User duy nhất toàn hệ thống. MongoDB chưa kết nối trả 503, không coi là kỳ có 0 lượt. Backend cần `MONGODB_URI` khi chạy ứng dụng. Kiểm thử riêng dùng `MERCHANT_TEST_MONGO_URI=mongodb://localhost:27017` và database tạm, không đổi cấu hình DB ứng dụng.
- GET `/export`: Excel tổng hợp toàn bộ tập lọc, bỏ phân trang của bảng Merchant; gồm tổng hợp, Merchant, theo thời gian và loại giao dịch. Không có token/credentials.

Bộ lọc: `start_date`, `end_date` dạng YYYY-MM-DD; mặc định đầu tháng tới hôm nay Việt Nam. `group_by`: day (mặc định), week (thứ Hai), month, quarter, year. `merchant_id`: UUID Merchant hoặc bỏ trống. `transaction_type`: ALL/PAYMENT/TRANSFER. `page` bắt đầu 1, `limit` 1–100 mặc định 20. Growth thêm `role` ALL/USER/MERCHANT cho thống kê tài khoản.

Thời gian dùng Asia/Ho_Chi_Minh và khoảng nửa mở từ 00:00 ngày đầu đến 00:00 ngày sau ngày cuối. Phí lọc ledger.created_at; giá trị/số giao dịch lọc transactions.created_at. Hai tập được tổng hợp riêng rồi ghép, không nhân đôi bởi nhiều fee_type. Trạng thái thành công hỗ trợ SUCCESS và giá trị legacy COMPLETED; Gateway hỗ trợ legacy PAID tương đương SUCCESS. Gateway là cohort yêu cầu có order_id theo ngày tạo; bộ lọc loại giao dịch không đổi cohort này vì request chưa thanh toán không có transaction_type. Tỷ lệ SUCCESS/(SUCCESS+EXPIRED+FAILED+CANCELLED), mẫu số 0 => null. Mốc thời gian trống có số 0.

Growth giao dịch thống kê giao dịch thành công toàn hệ thống nếu không lọc Merchant/loại; lọc role áp dụng tài khoản đăng ký. `users.created_at` là timestamp không timezone trong schema hiện tại, diễn giải theo giờ Việt Nam như cấu hình database; không ép ngầm theo timezone của tiến trình Node.

Dashboard dùng API overview và hiển thị doanh thu phí tách biệt năm KPI dòng tiền. API login hiện có được tái sử dụng cho Mobile App theo cùng khoảng ngày; đăng nhập không phải KPI theo Merchant.

Kiểm chứng: `NODE_ENV=test node --test tests/admin_fee_reports.test.js` tạo DB tách biệt, so SQL trực tiếp, thử ranh giới cuối ngày/đầu tháng, dữ liệu 107 Merchant, phân trang và đọc lại Excel. Test EXPLAIN ANALYZE chỉ chứng minh truy vấn hoạt động trên tập thử; không tuyên bố SLA trên dữ liệu production. Không thêm index trùng: cần đánh giá catalog/EXPLAIN thực tế khi triển khai với khối lượng lớn.
