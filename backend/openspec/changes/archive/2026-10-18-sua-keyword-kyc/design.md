# Design

## Context

Xem [proposal.md](proposal.md). Trong cơ sở dữ liệu PostgreSQL (bảng `user_kyc`), cột `status` mang kiểu `varchar(20)` lưu giá trị `APPROVED` khi người dùng hoàn thành định danh eKYC và lưu giá trị `null` khi hồ sơ chưa được duyệt hoặc chưa nộp.

## Goals / Non-Goals

**Goals:**
- Truy vấn trực tiếp `k.status AS kyc_status` trong câu lệnh SQL tại Backend (`user.repository.js`), không dùng giá trị mặc định giả lập `'UNVERIFIED'`.
- Cập nhật logic ánh xạ tại Frontend Web Admin (`user_model.dart`) để khớp chính xác giá trị `APPROVED` sang `KycStatus.verified` (badge "Đã xác thực") và `null` sang `KycStatus.unverified` (badge "Chưa định danh").
- Đồng bộ hóa các mock data kiểm thử trong `web-admin/test/` đảm bảo 100% pass và 0 lỗi phân tích tĩnh.

**Non-Goals:**
- Không sửa đổi cấu trúc bảng `user_kyc` hoặc thêm migration trong PostgreSQL.
- Không thay đổi luồng xử lý eKYC của người dùng cuối trong module `backend/src/modules/kyc/`.

## Decisions

### Quyết định 1: Lấy trực tiếp `k.status` từ cơ sở dữ liệu
- **Lựa chọn**: Trong hàm `getUsers` của `user.repository.js`, thay `COALESCE(k.status, 'UNVERIFIED') AS kyc_status` bằng `k.status AS kyc_status`.
- **Lý do**: Phản ánh nguyên bản giá trị thực tế trong DB: `APPROVED` hoặc `null`.
- **Phương án thay thế**: Chuẩn hóa thành `'VERIFIED'` tại SQL (Bị loại bỏ vì người dùng yêu cầu giữ nguyên keyword `APPROVED` và `null` như database).

### Quyết định 2: Hỗ trợ linh hoạt trong `UserModel.fromJson`
- **Lựa chọn**: Kiểm tra `final isVerified = kycRaw == 'APPROVED' || kycRaw == 'VERIFIED';`
- **Lý do**: Khớp ngay lập tức với dữ liệu thực tế từ database (`APPROVED`), đồng thời vẫn đảm bảo tính tương thích ngược với các mock data trong unit test.

## Risks / Trade-offs

- **[Khả năng trường `kyc_status` bị null trong JSON]** → Mitigation: `UserModel.fromJson` đã sử dụng `?.toString().toUpperCase()`. Khi `kyc_status` là `null`, biến `kycRaw` sẽ là `null` và tự động gán trạng thái `KycStatus.unverified`, hoàn toàn an toàn không gây lỗi Runtime Exception.
