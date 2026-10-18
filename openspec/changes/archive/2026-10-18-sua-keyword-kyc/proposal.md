# Proposal

## Why

Trong cơ sở dữ liệu PostgreSQL (bảng `user_kyc`), trạng thái định danh người dùng được lưu trữ với giá trị `APPROVED` (đối với tài khoản đã hoàn thành xác thực eKYC) và `null` (đối với tài khoản chưa xác thực danh tính). Tuy nhiên, hiện tại Backend đang dùng `COALESCE(k.status, 'UNVERIFIED')` và Frontend Web Admin chỉ so khớp từ khóa `'VERIFIED'`, dẫn đến các tài khoản đã xác thực thành công trong hệ thống (như tài khoản Phan Văn Thống với `status = 'APPROVED'`) lại bị hiển thị sai thành "Chưa định danh". Việc chuẩn hóa lại quy ước keyword giúp dữ liệu hiển thị chính xác, nhất quán với cơ sở dữ liệu gốc và phản ánh đúng trạng thái thực tế của hồ sơ người dùng.

## What Changes

- **Backend Query Update**: Thay thế câu lệnh gán mặc định `COALESCE(k.status, 'UNVERIFIED') AS kyc_status` thành `k.status AS kyc_status` trong `backend/src/admin/user/user.repository.js`, trả về trực tiếp giá trị `APPROVED` hoặc `null` từ bảng `user_kyc`.
- **Frontend Model Update**: Cập nhật logic parse `UserModel.fromJson` trong `web-admin/lib/features/user/models/user_model.dart` để nhận diện `APPROVED` (và `VERIFIED` để tương thích) tương ứng với `KycStatus.verified` ("Đã xác thực"), còn `null` hoặc không có hồ sơ tương ứng với `KycStatus.unverified` ("Chưa định danh").
- **Test Suite Synchronization**: Cập nhật các mock data kiểm thử trong `web-admin/test/user_api_service_test.dart` và `web-admin/test/widget_test.dart` đồng bộ theo quy ước `APPROVED` và `null`.

## Capabilities

### Modified Capabilities
- `admin-user`: Chuẩn hóa quy tắc hiển thị trạng thái KYC: tài khoản có `kyc_status` là `APPROVED` hiển thị badge "Đã xác thực", tài khoản có `kyc_status` là `null` hiển thị badge "Chưa định danh".

## Impact

- `backend/src/admin/user/user.repository.js`: Cập nhật câu lệnh SELECT trong hàm `getUsers`.
- `web-admin/lib/features/user/models/user_model.dart`: Cập nhật factory constructor `UserModel.fromJson`.
- `web-admin/test/user_api_service_test.dart`: Đảm bảo test case kiểm thử phản hồi đúng định dạng `APPROVED`.
- `web-admin/test/widget_test.dart`: Cập nhật mock client khớp `APPROVED`.
