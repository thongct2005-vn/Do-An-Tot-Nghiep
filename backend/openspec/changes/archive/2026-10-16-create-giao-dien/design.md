# Design: Kiến trúc Flutter Web Admin E-Wallet

## Context

Dự án cần xây dựng ứng dụng Web Admin cho hệ thống ví điện tử dựa trên bản thiết kế đã hoàn thiện trong Google Stitch (dự án "E-Wallet Web Admin", mã dự án `9344552715874992654`). Hệ thống giao diện được định hướng theo phong cách "Fintech Trust Engine" với tính thẩm mỹ doanh nghiệp cao, độ tương phản sắc nét và hỗ trợ dữ liệu tài chính dạng bảng với mật độ thông tin lớn.

Xem thêm động lực và phạm vi chi tiết tại `proposal.md` và các đặc tả hành vi tại thư mục `specs/`.

## Goals / Non-Goals

**Goals:**
- Thiết lập dự án Flutter Web hoàn chỉnh tại `web-admin/` tuân thủ kiến trúc Feature-first Modular Architecture.
- Tái hiện chính xác 100% ngôn ngữ thiết kế từ Stitch: hệ màu (`#0052CC`, `#0747A6`, `#F4F6F8`), typography (`Inter` cho nhãn/nội dung chung, `JetBrains Mono` cho số tiền, mã TxID, số dư ví).
- Triển khai trọn vẹn 3 modules: `dashboard`, `user`, `transaction`.
- Tách bạch các reusable widgets trong `core/widgets` để tái sử dụng xuyên suốt các màn hình (AdminShell, Sidebar, Topbar, StatusBadge, FinancialText, AppDataTable, ConfirmDialog).
- Cung cấp cơ chế Local Mock Data đầy đủ kịch bản hiển thị, tìm kiếm và lọc dữ liệu.

**Non-Goals:**
- Tích hợp API Backend (`http`, `dio`, REST, GraphQL) trong giai đoạn này.
- Thao tác trực tiếp với cơ sở dữ liệu (`ewallet_db.sql` hay bất kỳ DB nào).
- Chỉnh sửa hoặc can thiệp mã nguồn của `backend/`, `frontend/`, `web-client/`.
- Thêm các module ngoài phạm vi (như Cài đặt hệ thống, Báo cáo kiểm toán chuyên sâu, Quản trị phân quyền RBAC nâng cao).

## Decisions

### 1. Kiến trúc Feature-first Modular
- **Quyết định**: Tổ chức thư mục theo cấu trúc `lib/features/<feature_name>/` (dashboard, user, transaction) kết hợp thư mục `lib/core/` (theme, widgets, mock, routing).
- **Lý do**: Giúp từng module hoàn toàn độc lập, dễ mở rộng khi sau này chuyển đổi từ Mock Data sang API Service thực tế mà không làm ảnh hưởng các module khác.
- **Phương án thay thế đã cân nhắc**: Layer-first (`lib/screens/`, `lib/models/`, `lib/widgets/`). Bị loại bỏ vì khi ứng dụng mở rộng sẽ dẫn đến các thư mục chứa quá nhiều file không liên quan về mặt nghiệp vụ.

### 2. Hệ thống Tokens giao diện (Stitch Source of Truth)
- **Quyết định**: 
  - Khai báo lớp `AppColors`: Primary (`#0052CC`), Secondary (`#0747A6`), Surface (`#FFFFFF`), Canvas (`#F4F6F8`), Border (`#E2E8F0`), Status Thành công (`#10B981`), Đang xử lý (`#F59E0B`), Lỗi/Khóa (`#EF4444`).
  - Khai báo lớp `AppTypography`: Sử dụng `GoogleFonts.inter` cho toàn bộ văn bản UI thông thường và `GoogleFonts.jetbrainsMono` cho các thành phần `currency-kpi` (28px Bold), `currency-cell` (13px Medium) và mã TxID.
- **Lý do**: Tuân thủ chuẩn mực thiết kế Fintech của Stitch MCP, đảm bảo các chữ số tài chính hiển thị dạng số cố định (tabular numbers), không bị lệch dòng khi căn lề phải.
- **Phương án thay thế đã cân nhắc**: Sử dụng font mặc định của hệ thống. Bị loại bỏ vì làm sai lệch hoàn toàn nhận diện và tỷ lệ thị giác của bản thiết kế Stitch.

### 3. Điều hướng & Shell Bố cục (Layout Shell + Routing)
- **Quyết định**:
  - Xây dựng widget `AdminShell` cố định Sidebar (`width: 260px`) bên trái và Topbar (`height: 64px`) ở trên cùng, Content Canvas co giãn với khoảng đệm `24px`.
  - Sử dụng hệ thống Declarative Routing quản lý các URL: `/dashboard`, `/users`, `/transactions`, `/transactions/:id`.
- **Lý do**: Đáp ứng mô hình Fixed Shell + Fluid Canvas của Stitch trên môi trường web desktop, giúp thanh điều hướng luôn cố định khi cuộn dữ liệu bảng.
- **Phương án thay thế đã cân nhắc**: Mở trang chi tiết giao dịch dưới dạng Modal pop-up. Bị loại bỏ vì spec yêu cầu rõ ràng một trang chi tiết giao dịch độc lập tại `/transactions/:id`.

### 4. Chiến lược Local Mock Data
- **Quyết định**: Tạo các file `mock_dashboard_data.dart`, `mock_users_data.dart`, `mock_transactions_data.dart` chứa dữ liệu mẫu tĩnh mô phỏng nghiệp vụ thực tế.
  - Dashboard: Đúng 5 metric độc lập tính sẵn và mảng tọa độ cho biểu đồ Bar/Line.
  - User: Danh sách 15+ người dùng, có trạng thái Active/Suspended, cờ KYC và log lịch sử.
  - Transaction: Danh sách 30+ giao dịch với TxID, loại giao dịch, phân bổ thời gian hôm nay, tuần này, tháng này để kiểm thử bộ lọc.
- **Lý do**: Cách ly hoàn toàn với backend và database, cho phép chạy thử nghiệm và kiểm tra giao diện độc lập với độ ổn định cao.
- **Phương án thay thế đã cân nhắc**: Đọc file JSON từ asset. Bị loại bỏ vì việc khởi tạo Dart models/fixtures trực tiếp nhanh gọn hơn, không cần cấu hình asset bundle phức tạp trong giai đoạn prototype.

## Risks / Trade-offs

- **[Rủi ro] Biểu đồ giao dịch trên Flutter Web có thể gặp vấn đề về font/render**:
  - *Giải pháp*: Sử dụng thư viện biểu đồ Flutter Web phổ biến và ổn định (`fl_chart` hoặc tự vẽ bằng `CustomPainter` tùy theo cấu hình phụ thuộc) kết hợp CanvasKit renderer.
- **[Rủi ro] Hiệu năng render bảng dữ liệu dài trên Web**:
  - *Giải pháp*: Sử dụng `ListView.builder` hoặc phân trang (pagination) 10 dòng/trang trong `AppDataTable` để tránh dựng toàn bộ DOM một lúc.
- **[Rủi ro] Tràn màn hình trên các độ phân giải nhỏ hơn 1280px**:
  - *Giải pháp*: Cung cấp thanh cuộn ngang `SingleChildScrollView(scrollDirection: Axis.horizontal)` bọc ngoài Data Table để đảm bảo số liệu không bị cắt xén trên laptop màn hình nhỏ.
