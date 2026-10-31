# Spec Delta

## Purpose

Cung cấp các quy chuẩn tinh chỉnh giao diện màn hình Đăng nhập Quản trị viên trên Flutter Web, loại bỏ thanh cuộn dọc không mong muốn, gỡ bỏ thanh điều khiển mô phỏng thừa và hỗ trợ ô nhập liệu rỗng thân thiện.

## ADDED Requirements

### Requirement: Triệt tiêu thanh cuộn dọc hiển thị mặc định trên Flutter Web
Hệ thống SHALL ẩn hoàn toàn thanh cuộn dọc (Scrollbar) trên giao diện Web khi hiển thị màn hình Đăng nhập Quản trị. Toàn bộ vùng cuộn trung tâm MUST giữ nguyên khả năng cuộn nội dung khi màn hình thu nhỏ nhưng không được hiển thị thanh trượt dọc gây cản trở thị giác ngay cạnh khung thẻ đăng nhập.

#### Scenario: Hiển thị màn hình đăng nhập không xuất hiện thanh cuộn
- **WHEN** Quản trị viên truy cập màn hình Đăng nhập trên trình duyệt web
- **THEN** Giao diện hiển thị phẳng và hoàn toàn không có thanh cuộn dọc màu xám xuất hiện bên cạnh thẻ đăng nhập

### Requirement: Loại bỏ thanh điều khiển mô phỏng trạng thái UI
Hệ thống SHALL loại bỏ hoàn toàn khối nút mô phỏng trạng thái UI dưới đáy thẻ đăng nhập. Giao diện phía dưới thẻ form MUST chỉ bao gồm nền canvas phẳng và chân trang thông tin bản quyền.

#### Scenario: Không hiển thị cụm nút mô phỏng trạng thái dưới form
- **WHEN** Quản trị viên quan sát vùng bên dưới thẻ đăng nhập
- **THEN** Không xuất hiện khối 'MÔ PHỎNG TRẠNG THÁI UI' hay các nút chip chọn trạng thái

### Requirement: Khởi tạo trường nhập liệu ở trạng thái rỗng
Hệ thống SHALL khởi tạo giá trị ban đầu của ô Tên đăng nhập và Mật khẩu ở trạng thái rỗng. Hệ thống MUST hiển thị văn bản gợi ý (placeholder) 'Nhập tên đăng nhập' và 'Nhập mật khẩu', đồng thời cho phép người dùng tự do nhập liệu thực tế.

#### Scenario: Mở màn hình với hai trường nhập liệu trống
- **WHEN** Quản trị viên mở màn hình đăng nhập
- **THEN** Hai trường Tên đăng nhập và Mật khẩu không chứa dữ liệu gán sẵn và hiển thị văn bản gợi ý mờ tương ứng
