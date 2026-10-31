# Tasks

## 1. Cập nhật Backend Repository và Kiểm thử API

- [x] 1.1 Cập nhật câu lệnh SQL trong hàm `getUsers` tại `backend/src/admin/user/user.repository.js` từ `COALESCE(k.status, 'UNVERIFIED') AS kyc_status` thành `k.status AS kyc_status` và kiểm tra cú pháp file bằng lệnh node.
- [x] 1.2 Khởi động lại service Backend và gọi API `GET /api/v2/admin/user?search=0855313436` bằng lệnh node để xác nhận trường `kyc_status` của Phan Văn Thống trả về chính xác `"APPROVED"`.

## 2. Cập nhật Model và Kiểm thử Client Web Admin

- [x] 2.1 Cập nhật logic parse tại `UserModel.fromJson` trong `web-admin/lib/features/user/models/user_model.dart` để so khớp `kycRaw == 'APPROVED'` (và `'VERIFIED'`) chuyển sang `KycStatus.verified`, còn `null` chuyển sang `KycStatus.unverified`.
- [x] 2.2 Cập nhật mock dữ liệu và assert trong `web-admin/test/user_api_service_test.dart` và `web-admin/test/widget_test.dart` khớp với `APPROVED` và `null`.
- [x] 2.3 Chạy `flutter test` và `flutter analyze` trên project `web-admin` đảm bảo 100% test pass và 0 lỗi.
