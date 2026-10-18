# admin-transaction Specification

## Purpose

Cung cấp tính năng quản lý danh sách giao dịch tài chính, tra cứu chi tiết giao dịch, lọc dữ liệu theo thời gian và xuất báo cáo Excel cho hệ thống ví điện tử.

## Requirements

### Requirement: Bảng danh sách giao dịch và công cụ lọc
Hệ thống SHALL hiển thị bảng danh sách giao dịch chuẩn Enterprise gồm các cột: Mã giao dịch (TxID font JetBrains Mono), Thời gian, Loại giao dịch (Nạp tiền, Rút tiền, Thanh toán QR), Ví nguồn, Ví đích, Số tiền (font JetBrains Mono căn phải), Phí dịch vụ, và Trạng thái giao dịch (Badge). Toolbar của bảng MUST cung cấp ô tìm kiếm chính xác theo transaction.id, cụm nút lọc phân đoạn theo ngày/tuần/tháng dựa trên created_at, và nút xuất Excel.

#### Scenario: Tìm kiếm giao dịch theo transaction.id
- **WHEN** Quản trị viên nhập mã giao dịch "TXN-20241028-98412" vào ô tìm kiếm
- **THEN** Bảng giao dịch lọc và chỉ hiển thị bản ghi có mã TxID trùng khớp

#### Scenario: Lọc giao dịch theo khoảng thời gian
- **WHEN** Quản trị viên chọn phân đoạn "Tuần này"
- **THEN** Bảng giao dịch cập nhật danh sách các giao dịch có trường created_at nằm trong 7 ngày gần nhất

#### Scenario: Kích hoạt xuất dữ liệu Excel
- **WHEN** Quản trị viên nhấn nút "Xuất Excel" trên thanh công cụ
- **THEN** Hệ thống kích hoạt tác vụ xuất file dữ liệu giao dịch với phản hồi thị giác thành công

### Requirement: Không hiển thị KPI hoặc biểu đồ trên màn hình giao dịch
Màn hình danh sách giao dịch SHALL dành toàn bộ diện tích không gian cho thanh công cụ và bảng dữ liệu. Hệ thống MUST NOT hiển thị bất kỳ thẻ KPI tóm tắt hoặc biểu đồ trực quan hóa số liệu nào tại màn hình Quản lý giao dịch này.

#### Scenario: Kiểm tra bố cục màn hình giao dịch
- **WHEN** Quản trị viên điều hướng đến trang Quản lý giao dịch
- **THEN** Màn hình chỉ hiển thị tiêu đề trang, thanh công cụ tra cứu/lọc/xuất Excel và bảng dữ liệu, không có thẻ KPI hay biểu đồ nào xuất hiện

### Requirement: Trang chi tiết giao dịch chuyên biệt
Hệ thống SHALL cung cấp một màn hình chi tiết giao dịch riêng biệt tại đường dẫn `/transactions/:id` khi quản trị viên nhấp vào một dòng giao dịch. Trang chi tiết MUST hiển thị toàn bộ thuộc tính giao dịch, thẻ tóm tắt số tiền & trạng thái kích thước lớn, chi tiết các bên tham gia, biểu phí & thuế VAT, cùng dòng thời gian (timeline) các bước xử lý giao dịch.

#### Scenario: Điều hướng đến trang chi tiết giao dịch
- **WHEN** Quản trị viên nhấp vào mã giao dịch "TXN-20241028-98412" trên bảng danh sách
- **THEN** Hệ thống chuyển hướng sang trang chi tiết giao dịch `/transactions/TXN-20241028-98412` và hiển thị đầy đủ thông số kỹ thuật của giao dịch này
