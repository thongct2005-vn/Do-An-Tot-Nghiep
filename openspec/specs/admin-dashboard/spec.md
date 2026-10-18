# admin-dashboard Specification

## Purpose

Cung cấp màn hình Dashboard hiển thị số liệu giám sát tổng quan dòng tiền và thống kê khối lượng giao dịch cho hệ thống ví điện tử.

## Requirements

### Requirement: Hiển thị đúng 5 thẻ KPI dòng tiền
Hệ thống SHALL hiển thị chính xác 5 thẻ KPI dòng tiền tại màn hình Dashboard bao gồm: Tổng số giao dịch (COUNT(id)), Tổng tiền nạp (TOPUP thành công), Tổng tiền rút (WITHDRAW thành công), Dòng tiền ròng (Nạp thành công trừ Rút thành công), và Tổng tiền thanh toán QR (PAYMENT thành công). Các thẻ số liệu tiền tệ MUST sử dụng phông chữ dạng Tabular Numbers (JetBrains Mono) và có phân định dấu cộng trừ rõ ràng đối với dòng tiền ròng.

#### Scenario: Hiển thị đầy đủ 5 thẻ KPI với dữ liệu tài chính
- **WHEN** Quản trị viên truy cập vào màn hình Dashboard
- **THEN** Hệ thống hiển thị đúng 5 thẻ chỉ số tài chính với đầy đủ nhãn, giá trị tiền tệ định dạng tiếng Việt (hậu tố ₫) và chỉ số phần trăm biến động so với kỳ trước

#### Scenario: Kiểm tra công thức tính Dòng tiền ròng
- **WHEN** Dữ liệu nạp thành công là 48.650.000.000 ₫ và rút thành công là 31.280.000.000 ₫
- **THEN** Thẻ Dòng tiền ròng hiển thị chính xác giá trị dương +17.370.000.000 ₫ với màu sắc xanh chỉ báo tích cực

### Requirement: Hiển thị biểu đồ thống kê giao dịch
Hệ thống SHALL hiển thị một biểu đồ thống kê giao dịch đa luồng được đặt ngay phía dưới hàng 5 thẻ KPI. Biểu đồ MUST cho phép quan sát sự biến động của các luồng nạp, rút, thanh toán và dòng tiền ròng theo chuỗi thời gian, đồng thời hỗ trợ bộ lọc chuyển đổi chu kỳ hiển thị.

#### Scenario: Tương tác với bộ lọc thời gian trên biểu đồ
- **WHEN** Quản trị viên chọn chuyển đổi giữa các mốc thời gian "Hôm nay", "7 ngày qua", "Tháng này"
- **THEN** Biểu đồ cập nhật lại các điểm dữ liệu tương ứng với mốc thời gian được chọn mà không cần tải lại toàn bộ trang
