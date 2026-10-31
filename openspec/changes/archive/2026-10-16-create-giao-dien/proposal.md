# Proposal: Triển khai Giao diện Web Admin bằng Flutter Web

## Why

Hệ thống ví điện tử cần giao diện quản trị (Web Admin) trực quan, chuẩn xác để các chuyên viên vận hành, kế toán và quản trị rủi ro có thể giám sát số liệu dòng tiền, quản lý danh sách người dùng và tra cứu nhật ký giao dịch. Thiết kế hoàn thiện đã sẵn sàng trong Google Stitch (dự án "E-Wallet Web Admin", design system "Fintech Trust Engine"). Bước khởi đầu cần triển khai khung giao diện Flutter Web hoàn chỉnh với dữ liệu mock cục bộ, bám sát 100% thiết kế mà không phụ thuộc vào backend hay cơ sở dữ liệu.

## What Changes

- Khởi tạo kiến trúc Feature-first Modular cho ứng dụng Flutter Web tại `web-admin/`.
- Thiết lập hệ thống Design System Tokens theo đúng chuẩn Stitch (màu sắc Primary `#0052CC`, Secondary `#0747A6`, typography `Inter` cho giao diện và `JetBrains Mono` cho tiền tệ/mã giao dịch).
- Triển khai **Module 1 - Dashboard**: Đúng 5 thẻ KPI dòng tiền (`Tổng số giao dịch`, `Tổng tiền nạp`, `Tổng tiền rút`, `Dòng tiền ròng`, `Tổng tiền thanh toán QR`) và biểu đồ thống kê giao dịch đa luồng kết hợp Bar & Line ngay dưới 5 thẻ KPI.
- Triển khai **Module 2 - User Management**: Bảng danh sách người dùng, thanh tìm kiếm người dùng (theo Tên/SĐT), ngăn trượt chi tiết (Slide-over Drawer 480px) mở tại chỗ khi click vào dòng, hộp thoại xác nhận vô hiệu hóa tài khoản (Confirmation Dialog 440px) có trường nhập lý do bắt buộc.
- Triển khai **Module 3 - Transaction Management**: Bảng danh sách giao dịch chuẩn Enterprise, trang chi tiết giao dịch riêng biệt (`/transactions/:id`), ô tìm kiếm theo `transaction.id`, bộ lọc theo ngày/tuần/tháng dựa trên `created_at`, và nút xuất Excel. Tuyệt đối không chứa thẻ KPI hay biểu đồ tại màn hình này.
- Xây dựng kho dữ liệu giả lập (Local Mock Data) cho 3 modules, không kết nối API backend, không thao tác cơ sở dữ liệu.

## Capabilities

### New Capabilities
- `admin-dashboard`: Quản lý hiển thị tổng quan số liệu tài chính gồm đúng 5 thẻ KPI dòng tiền và biểu đồ thống kê giao dịch theo chuỗi thời gian.
- `admin-user`: Quản lý danh sách người dùng, tìm kiếm, hiển thị chi tiết người dùng qua Drawer và quy trình xác nhận vô hiệu hóa tài khoản.
- `admin-transaction`: Quản lý danh sách giao dịch, trang chi tiết giao dịch, tìm kiếm TxID, lọc ngày/tuần/tháng và xuất dữ liệu báo cáo Excel.

### Modified Capabilities
<!-- Không có capability nào bị thay đổi do đây là tính năng mới hoàn toàn cho web-admin -->

## Impact

- **Mã nguồn bị tác động**: Chỉ tác động trong thư mục `web-admin/` (khởi tạo Flutter Web app, các widget dùng chung, theme tokens, router và 3 modules tính năng).
- **Phần mềm/hệ thống ngoài phạm vi**: Tuyệt đối không đọc hoặc thay đổi `backend/`, `frontend/`, `web-client/`.
- **Hạ tầng & Dữ liệu**: Không sử dụng cơ sở dữ liệu SQL/NoSQL, không triển khai API client (`http`/`dio`), toàn bộ hoạt động dựa trên local mock fixtures.
