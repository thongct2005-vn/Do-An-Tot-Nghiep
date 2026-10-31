# admin-login-ui Specification

## Purpose

Cung cấp giao diện màn hình Đăng nhập Quản trị viên (Admin Login Screen) trên nền tảng Flutter Web Admin, bao gồm biểu mẫu nhập liệu chuẩn thiết kế Stitch, kiểm tra tính hợp lệ cơ bản tại client, mô phỏng các trạng thái UI và điều hướng demo vào Dashboard.

## Requirements

### Requirement: Hiển thị giao diện Đăng nhập Quản trị viên chuẩn thiết kế Stitch
Hệ thống SHALL hiển thị màn hình Đăng nhập Quản trị độc lập toàn màn hình với bố cục căn giữa gồm thẻ chứa form độ rộng tối đa 440px trên nền canvas sáng. Thẻ chứa form MUST bao gồm biểu tượng logo E-Wallet Admin, tiêu đề 'Đăng nhập quản trị', mô tả chức năng, hai trường nhập liệu Tên đăng nhập và Mật khẩu có đánh dấu bắt buộc, cùng nút Đăng nhập chính màu xanh thương hiệu (#0052CC).

#### Scenario: Hiển thị đầy đủ các thành phần giao diện đăng nhập mặc định
- **WHEN** Quản trị viên truy cập vào ứng dụng Flutter Web Admin ở trạng thái chưa đăng nhập
- **THEN** Hệ thống hiển thị màn hình Đăng nhập với thanh chỉ báo bảo mật phía trên, thẻ đăng nhập căn giữa chứa đầy đủ ô nhập tên đăng nhập, mật khẩu, nút Đăng nhập và chân trang bản quyền

#### Scenario: Che giấu ký tự mật khẩu khi nhập liệu
- **WHEN** Quản trị viên nhập ký tự vào trường Mật khẩu
- **THEN** Các ký tự mật khẩu được che giấu dưới dạng ký tự bảo mật chấm tròn (obscure text)

### Requirement: Kiểm tra tính hợp lệ của dữ liệu nhập tại giao diện
Hệ thống SHALL kiểm tra tính hợp lệ của biểu mẫu đăng nhập ngay trên giao diện trước khi kích hoạt quy trình mô phỏng xác thực. Nếu trường Tên đăng nhập hoặc Mật khẩu bị để trống, hệ thống MUST hiển thị viền đỏ cảnh báo tại trường tương ứng, xuất hiện thông báo lỗi inline ngay bên dưới trường và hiển thị thanh banner cảnh báo ở đầu biểu mẫu.

#### Scenario: Để trống tên đăng nhập khi nhấn nút Đăng nhập
- **WHEN** Quản trị viên để trống trường Tên đăng nhập và nhấn nút Đăng nhập
- **THEN** Hệ thống hiển thị viền đỏ quanh ô Tên đăng nhập, xuất hiện thông báo 'Vui lòng nhập tên đăng nhập' và hiển thị banner cảnh báo trên đầu biểu mẫu

#### Scenario: Để trống mật khẩu khi nhấn nút Đăng nhập
- **WHEN** Quản trị viên nhập tên đăng nhập nhưng để trống trường Mật khẩu và nhấn nút Đăng nhập
- **THEN** Hệ thống hiển thị viền đỏ quanh ô Mật khẩu, xuất hiện thông báo 'Vui lòng nhập mật khẩu' và không kích hoạt trạng thái loading

### Requirement: Mô phỏng trạng thái xác thực và phản hồi giao diện
Hệ thống SHALL cung cấp cơ chế mô phỏng phản hồi trạng thái đăng nhập nội bộ trên giao diện người dùng. Khi gửi biểu mẫu hợp lệ, nút Đăng nhập MUST chuyển sang trạng thái Loading (vô hiệu hóa tương tác, hiển thị con quay tiến trình và đổi nhãn thành 'Đang xác thực tài khoản...'). Sau thời gian giả lập xử lý, hệ thống MUST hiển thị banner xanh thông báo xác thực thành công.

#### Scenario: Kích hoạt trạng thái loading khi gửi biểu mẫu hợp lệ
- **WHEN** Quản trị viên nhấn nút Đăng nhập với đầy đủ tên đăng nhập và mật khẩu
- **THEN** Nút Đăng nhập chuyển sang trạng thái vô hiệu hóa, hiển thị vòng quay tiến trình và nhãn nút đổi thành 'Đang xác thực tài khoản...'

#### Scenario: Hiển thị thông báo xác thực thành công sau thời gian giả lập
- **WHEN** Thời gian giả lập xác thực hoàn tất
- **THEN** Hệ thống hiển thị banner trạng thái màu xanh lá với thông báo 'Xác thực thành công! Đang chuyển hướng đến Dashboard Quản trị...'

### Requirement: Điều hướng demo vào Dashboard sau khi xác thực thành công
Hệ thống SHALL tự động chuyển đổi trạng thái định tuyến nội bộ để điều hướng người dùng từ màn hình Đăng nhập sang màn hình Dashboard bên trong khung giao diện quản trị (AdminShell) sau khi quá trình mô phỏng xác thực thành công hoàn tất.

#### Scenario: Chuyển hướng vào Dashboard sau đăng nhập thành công
- **WHEN** Thông báo xác thực thành công được kích hoạt và độ trễ chuyển tiếp kết thúc
- **THEN** Màn hình Đăng nhập được thay thế hoàn toàn bằng giao diện AdminShell hiển thị thanh điều hướng bên trái và nội dung Dashboard tổng quan ví điện tử

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
