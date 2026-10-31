# Design

## Context

Giao diện Quản lý người dùng trên Flutter Web Admin (`UserListScreen`, `UserDataTable`, `UserDetailDrawer`) đã kết nối với Backend API `/api/v2/admin/user`. Tuy nhiên, bên trong `UserDetailDrawer`, một số hàm định dạng dữ liệu vẫn còn giữ lại các giá trị mẫu (mock fallback) như "Vietcombank **** 6899", "hoanglong.le@gmail.com", "001095012847". Đồng thời tại Backend, câu lệnh SQL truy vấn ngân hàng trong `adminUserRepository.getUsers` đang sử dụng điều kiện `lba.is_default = true`, làm cho các tài khoản trong cơ sở dữ liệu `ewallet_db.sql` (toàn bộ mang `is_default = false`) bị trả về `NULL`.

Xem [proposal.md](file:///d:/KH23_CNTT_HK6_DATN_CODE/openspec/changes/lam-sach-du-lieu-user/proposal.md) để biết thêm chi tiết về bối cảnh và động lực thay đổi.

## Goals / Non-Goals

**Goals:**
- Tối ưu câu lệnh SQL trong `backend/src/admin/user/user.repository.js` để truy vấn chính xác ngân hàng liên kết của người dùng (kể cả khi `is_default = false`).
- Chuẩn hóa phản hồi của backend, đảm bảo người dùng chưa liên kết ngân hàng trả về đúng `bank_name: "Chưa liên kết"` và `bank_account: ""`.
- Làm sạch hoàn toàn các chuỗi fallback giả định trong `web-admin/lib/features/user/presentation/widgets/user_detail_drawer.dart`, phản ánh 100% dữ liệu thực từ PostgreSQL.
- Đảm bảo hiển thị trực quan: tài khoản chưa liên kết ngân hàng phải hiển thị nhãn "Chưa liên kết" màu xám `#64748B`, không in đậm.
- Khối thông báo an ninh phản ánh đúng trạng thái KYC của người dùng thay vì thông báo tĩnh FIDO2.
- Bảo đảm toàn bộ test case hiện có trong `web-admin/test/` tiếp tục vượt qua.

**Non-Goals:**
- Tuyệt đối không can thiệp, sửa đổi hay loại bỏ mock fallback của 2 phân hệ Giao dịch (`TransactionListScreen`) và Bảng điều khiển (`DashboardScreen`).
- Không thay đổi schema cơ sở dữ liệu PostgreSQL (`ewallet_db.sql`).
- Không can thiệp vào các API của User App di động (`backend/src/modules/`).

## Decisions

### 1. Truy vấn ngân hàng bằng `LEFT JOIN LATERAL` tại Backend
- **Quyết định**: Thay thế câu `LEFT JOIN linked_bank_accounts lba ON u.id = lba.user_id AND lba.is_default = true` bằng `LEFT JOIN LATERAL`:
  ```sql
  LEFT JOIN LATERAL (
    SELECT lba.account_number, b.name
    FROM linked_bank_accounts lba
    JOIN banks b ON lba.bank_id = b.id
    WHERE lba.user_id = u.id AND lba.status = 'ACTIVE'
    ORDER BY lba.is_default DESC, lba.created_at DESC
    LIMIT 1
  ) lba_bank ON true
  ```
- **Lý do**:
  - Tự động ưu tiên ngân hàng mặc định nếu có (`is_default = true`).
  - Nếu không có ngân hàng mặc định (như dữ liệu hiện tại trong `ewallet_db.sql`), hệ thống tự động lấy ngân hàng hoạt động mới nhất được liên kết.
  - Nếu người dùng chưa từng liên kết ngân hàng nào, kết quả trả về `NULL` an toàn mà không làm chậm câu truy vấn và không gây lỗi N+1.
- **Lựa chọn thay thế đã xem xét**:
  - *Chạy lệnh UPDATE dữ liệu để gán `is_default = true`*: Bị loại bỏ vì không giải quyết được gốc rễ vấn đề khi có người dùng mới liên kết mà chưa kịp set default, và vi phạm nguyên tắc bảo toàn dữ liệu gốc.
  - *Query ngân hàng riêng bằng vòng lặp trong Node.js*: Bị loại bỏ vì gây N+1 query khi danh sách người dùng lớn.

### 2. Chuẩn hóa hàm format `_formatBankAccount` trên Client Web Admin
- **Quyết định**:
  ```dart
  String _formatBankAccount(String bankName, String bankAccount) {
    final name = bankName.trim();
    final acc = bankAccount.trim();
    if (name.isEmpty || name == 'Chưa liên kết' || acc.isEmpty) {
      return 'Chưa liên kết';
    }
    if (acc.contains('****')) {
      return '$name $acc';
    }
    if (acc.length >= 4) {
      return '$name **** ${acc.substring(acc.length - 4)}';
    }
    return '$name $acc';
  }
  ```
  - Trong widget hiển thị: Nếu kết quả là `'Chưa liên kết'`, áp dụng màu xám `Color(0xFF64748B)` và `FontWeight.w500`. Nếu đã liên kết, hiển thị màu đậm `Color(0xFF0F172A)` và `FontWeight.w700`.
- **Lý do**: Loại bỏ dứt điểm hiện tượng tài khoản chưa liên kết ngân hàng lại bị tự ý gán `'Vietcombank **** 6899'`.

### 3. Làm sạch các fallback định danh cá nhân khác
- **Email**: `user.email.isNotEmpty ? user.email : 'Chưa cập nhật'` (loại bỏ `'hoanglong.le@gmail.com'`).
- **CCCD**: `user.kycDetail?.cccdNumber ?? (user.kycStatus == KycStatus.verified ? 'Đang cập nhật' : 'Chưa cập nhật')` (loại bỏ `'001095012847'`).
- **Số điện thoại**: Định dạng từ `user.phone`, nếu rỗng hiển thị `'Chưa cập nhật'` (loại bỏ `'0912.845.678'`).
- **Mã User**: Định dạng `USR-...` dựa trên ID thật của người dùng (loại bỏ fallback `'USR-98214'`).
- **Khối thông báo an ninh**:
  - Nếu `user.kycStatus == KycStatus.verified`: "Tài khoản đã hoàn tất xác thực danh tính (KYC Cấp 2) theo quy định của Ngân hàng Nhà nước."
  - Nếu chưa xác thực: "Tài khoản chưa hoàn tất xác thực danh tính (KYC). Giới hạn hạn mức và một số tính năng thanh toán theo quy định."

## Risks / Trade-offs

- **[Risk] Ảnh hưởng tới widget test hiện tại**  
  → *Mitigation*: Các widget test trong `test/widget_test.dart` và `test/user_api_service_test.dart` đã dùng mock client trả về đầy đủ `bank_name: 'Vietcombank'`, `bank_account: '1012345678'`, không phụ thuộc vào chuỗi hardcode fallback. Sau khi sửa, sẽ chạy lại toàn bộ suite test để kiểm chứng.

- **[Risk] Người dùng có nhiều hơn 1 tài khoản ngân hàng liên kết**  
  → *Mitigation*: Drawer chi tiết của một người dùng hiện tại hiển thị ngân hàng đại diện (chính). Câu lệnh SQL `ORDER BY lba.is_default DESC, lba.created_at DESC LIMIT 1` đảm bảo luôn chọn ngân hàng phù hợp nhất.
