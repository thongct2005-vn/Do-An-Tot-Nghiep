# Tasks

## 1. Thiết lập Thư viện & Mô hình Dữ liệu

- [x] 1.1 Thêm dependency `shared_preferences: ^2.3.0` vào `web-admin/pubspec.yaml` và chạy `flutter pub get` để tải gói.
- [x] 1.2 Bổ sung phương thức `toJson()` và `copyWith()` vào `AdminSessionModel` trong `web-admin/lib/features/auth/models/admin_session_model.dart` để phục vụ tuần tự hóa JSON.

## 2. Dịch vụ Lưu trữ & Mở rộng API Client

- [x] 2.1 Tạo file `web-admin/lib/features/auth/data/auth_storage_service.dart` cài đặt các hàm `saveSession`, `getSession`, và `clearSession` dựa trên `SharedPreferences`.
- [x] 2.2 Bổ sung các hàm `getMe`, `refreshToken`, và `logout` vào `AuthApiService` (`web-admin/lib/features/auth/data/auth_api_service.dart`) gọi tới các API Backend tương ứng.

## 3. Khôi phục Phiên khi Khởi động & Đăng xuất

- [x] 3.1 Cập nhật `_WebAdminAppState` trong `web-admin/lib/app.dart` thêm cờ `_isCheckingAuth` và phương thức khôi phục phiên `_checkExistingSession()` trong `initState()`.
- [x] 3.2 Tích hợp lưu phiên vào `AuthStorageService` khi đăng nhập thành công tại `LoginScreen.onLoginSuccess` và dọn sạch storage khi nhấn nút Đăng xuất trên `AdminShell`.

## 4. Kiểm thử & Đảm bảo Chất lượng

- [x] 4.1 Viết unit tests cho `AuthStorageService` và các phương thức `getMe`, `refreshToken` của `AuthApiService` trong `web-admin/test/auth_storage_service_test.dart`.
- [x] 4.2 Chạy toàn bộ kiểm thử tự động của `web-admin` (`flutter test`) để xác nhận mọi kịch bản đăng nhập, duy trì phiên và F5 đều hoạt động chính xác.
