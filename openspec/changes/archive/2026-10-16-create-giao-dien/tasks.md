# Tasks

## 1. Khởi tạo Dự án & Nền tảng Giao diện (Foundation & Design Tokens)

- [x] 1.1 Khởi tạo cấu trúc dự án Flutter Web tại thư mục `web-admin/` và kiểm tra ứng dụng có thể phân tích thành công bằng `flutter analyze`.
- [x] 1.2 Xây dựng hệ thống Design Tokens tại `web-admin/lib/core/theme/` gồm `AppColors` (Primary `#0052CC`, Secondary `#0747A6`, Status colors), `AppTypography` (`Inter` cho văn bản, `JetBrains Mono` cho số liệu tài chính) và `AppDimensions` (bán kính bo góc 4px/8px) khớp với Stitch MCP.
- [x] 1.3 Xây dựng khung giao diện `AdminShell` tại `web-admin/lib/core/widgets/app_shell.dart` với `Sidebar` cố định 260px và `Topbar` cố định 64px, kiểm tra layout neo giữ chuẩn xác.
- [x] 1.4 Xây dựng các Reusable Widgets dùng chung tại `web-admin/lib/core/widgets/` (`StatusBadge`, `FinancialText`, `AppDataTable`, `AppSearchInput`, `AppConfirmDialog`).

## 2. Xây dựng Dữ liệu Cục bộ (Local Mock Data)

- [x] 2.1 Xây dựng `mock_dashboard_data.dart` cung cấp dữ liệu cho đúng 5 thẻ KPI dòng tiền và các điểm dữ liệu chuỗi thời gian cho biểu đồ.
- [x] 2.2 Xây dựng `mock_users_data.dart` chứa danh sách 15+ người dùng với trạng thái hoạt động, cờ KYC, số dư khả dụng và nhật ký audit log.
- [x] 2.3 Xây dựng `mock_transactions_data.dart` chứa 30+ giao dịch tài chính với mã TxID, các loại giao dịch (TOPUP, WITHDRAW, PAYMENT), trạng thái (SUCCESS, PENDING, FAILED) và phân bổ thời gian.

## 3. Triển khai Module 1 - Dashboard

- [x] 3.1 Xây dựng `KpiCard` và `KpiCardGrid` hiển thị chính xác 5 thẻ KPI dòng tiền (`Tổng số giao dịch`, `Tổng tiền nạp`, `Tổng tiền rút`, `Dòng tiền ròng`, `Tổng tiền thanh toán QR`), kiểm tra font `JetBrains Mono` và định dạng tiền tệ tiếng Việt.
- [x] 3.2 Xây dựng widget biểu đồ `TxStatsChart` đặt ngay phía dưới hàng 5 thẻ KPI, tích hợp bộ chuyển đổi khoảng thời gian `Hôm nay | 7 ngày | Tháng này`.
- [x] 3.3 Ghép nối hoàn chỉnh `DashboardScreen` tại router `/dashboard` và kiểm tra hiển thị trực quan đồng bộ giữa 5 thẻ KPI và biểu đồ.

## 4. Triển khai Module 2 - Quản lý Người dùng

- [x] 4.1 Xây dựng `UserDataTable` hiển thị danh sách người dùng với các cột thông tin tài khoản, số dư và badge trạng thái, tích hợp thanh tìm kiếm theo Họ tên / Số điện thoại.
- [x] 4.2 Xây dựng ngăn trượt chi tiết `UserDetailDrawer` chiều rộng 480px mở từ mép phải khi click vào một dòng trong danh sách, hiển thị thông tin KYC, số dư, hạn mức và audit log.
- [x] 4.3 Xây dựng hộp thoại xác nhận `DeactivateUserDialog` (độ rộng 440px) có icon cảnh báo đỏ `#EF4444`, giải thích hậu quả và ô nhập lý do khóa bắt buộc.
- [x] 4.4 Ghép nối hoàn chỉnh `UserListScreen` tại router `/users`, kiểm tra tương tác click dòng mở Drawer tại chỗ và kích hoạt Dialog xác nhận vô hiệu hóa.

## 5. Triển khai Module 3 - Quản lý Giao dịch

- [x] 5.1 Xây dựng `TxDataTable` và `TxToolbar` hiển thị bảng giao dịch chuẩn Enterprise với ô tìm kiếm theo `transaction.id`, bộ lọc theo ngày/tuần/tháng dựa trên `created_at` và nút xuất Excel. Xác minh màn hình tuyệt đối không có thẻ KPI hay biểu đồ.
- [x] 5.2 Xây dựng trang chi tiết giao dịch chuyên biệt `TransactionDetailScreen` tại đường dẫn `/transactions/:id` hiển thị thẻ tổng quan số tiền, các bên tham gia, biểu phí VAT và timeline lịch sử xử lý.
- [x] 5.3 Ghép nối hoàn chỉnh điều hướng từ danh sách giao dịch sang trang chi tiết `/transactions/:id`, kiểm tra các chức năng tìm kiếm TxID và lọc thời gian.

## 6. Tích hợp Hệ thống & Kiểm tra Ranh giới (System Integration & Verification)

- [x] 6.1 Cấu hình Router tổng và kiểm tra điều hướng mượt mà giữa cả 3 màn hình `/dashboard`, `/users`, `/transactions` trên cùng layout `AdminShell`.
- [x] 6.2 Kiểm tra xác thực ranh giới nghiêm ngặt: đảm bảo không có file nào bị thay đổi trong `backend/`, `frontend/`, `web-client/` và ứng dụng không gọi bất kỳ API/Database nào.
