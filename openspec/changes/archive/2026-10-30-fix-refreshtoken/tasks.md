# Tasks: Kiểm tra trạng thái tài khoản khi làm mới token

## 1. Repository và service

- [x] 1.1 Trong `backend/src/modules/auth/auth.repository.js`, hàm `findUserByRefreshToken` (L161-171): thêm `u.status` vào danh sách `SELECT`, giữ nguyên `WHERE u.refresh_token = $1`. Kiểm tra: đọc lại câu query thấy cột `status`, không có điều kiện lọc mới.
- [x] 1.2 Trong `backend/src/modules/auth/auth.service.js`, hàm `refreshToken` (L310-330): ngay sau khối `if (!user)` (giữ nguyên 401 và câu báo cũ), thêm `if (user.status !== "ACTIVE") throw httpError(403, "Tài khoản bị khóa")`. Khối này phải nằm trước `tokenUtil.generateAuthTokens` và `authRepository.updateRefeshToken`. Kiểm tra: test ở 1.3 chạy qua.
- [x] 1.3 Tạo `backend/tests/user_auth_refresh.test.js` theo kiểu `node:test` + `node:assert` giống `backend/tests/admin_auth_service.test.js` (mock bằng cách gán đè hàm repository và khôi phục trong `beforeEach`). Viết 3 case theo spec `user-auth`:
  - (a) user `ACTIVE`: trả về `token.access_token` và `token.refresh_token`, `updateRefeshToken` được gọi đúng 1 lần.
  - (b) user `BLOCKED`: reject với `statusCode === 403`, message "Tài khoản bị khóa", `updateRefeshToken` không được gọi.
  - (c) repository trả `undefined`: reject với `statusCode === 401` và câu báo cũ.

  Kiểm tra: `cd backend; node --test tests/user_auth_refresh.test.js` qua cả 3 case.

## 2. Kiểm tra tích hợp

- [x] 2.1 Chạy lại `cd backend; node --test tests/` và xác nhận các test cũ (gồm `admin_auth_service.test.js`) vẫn qua. Đây là bằng chứng change không ảnh hưởng luồng refresh của Admin.
- [x] 2.2 Kiểm tra thủ công trên DB dev: đăng nhập một user test để lấy `refresh_token`, rồi chạy `UPDATE users SET status = 'BLOCKED' WHERE id = ...` mà không xóa `refresh_token`. Gọi `POST /refresh-token` phải nhận 403 "Tài khoản bị khóa". Sau đó trả `status = 'ACTIVE'` và gọi lại phải nhận 200. Ghi kết quả vào phần tóm tắt khi apply.

## Workflow follow-up

- Chạy `/opsx-archive` sau khi review xong để gộp capability `user-auth` vào `openspec/specs/`.

