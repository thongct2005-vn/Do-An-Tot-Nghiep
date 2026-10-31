# Design: Kiểm tra trạng thái tài khoản khi làm mới token

## Context

Luồng hiện tại (xem proposal.md - Why):

```
POST /refresh-token
  --> authMiddleware.verifyRefreshToken   (chỉ kiểm tra chữ ký JWT)
  --> authController.refreshToken         (auth.controller.js:L81)
  --> authService.refreshToken            (auth.service.js:L310)
        findUserByRefreshToken(token)     (auth.repository.js:L161)
          SELECT id, phone, full_name, balance, role
          WHERE refresh_token = hash(token)          <-- không có status
        không thấy  --> 401 "đăng nhập trên thiết bị khác"
        thấy        --> tạo token mới, updateRefeshToken
```

Trong cùng module, luồng đăng nhập đã kiểm tra trạng thái ở tầng service (`auth.service.js:L42-44`: `if (user.status !== "ACTIVE") throw httpError(403, "Tài khoản bị khóa")`).

## Goals / Non-Goals

**Goals:**
- Tầng service tự từ chối tài khoản không `ACTIVE`, không còn dựa vào việc `refresh_token` đã bị xóa hay chưa.
- Thông báo lỗi giống luồng đăng nhập.

**Non-Goals:**
- Kiểm tra `role` trong luồng refresh. Luồng đăng nhập có kiểm tra (`L46-48`), nhưng refresh token chỉ được cấp cho user đã qua đăng nhập nên không thêm ở đây.
- Thu hồi access token đang còn hạn.

## Decisions

### 1. Kiểm tra ở service, không lọc trong SQL
- **Chọn:** `findUserByRefreshToken` trả thêm `u.status`. `authService.refreshToken` kiểm tra `user.status !== "ACTIVE"` và ném `httpError(403, "Tài khoản bị khóa")`. Bước kiểm tra đặt sau bước "không tìm thấy" và trước `generateAuthTokens`.
- **Phương án bỏ:** thêm `AND u.status = 'ACTIVE'` vào `WHERE`. Chỉ sửa một dòng, nhưng service không phân biệt được "không có token" với "bị khóa", nên vẫn trả câu báo sai.
- **Lý do:** đúng cách luồng đăng nhập đang làm, và báo đúng lý do cho client.

### 2. Không cấp và không ghi đè token khi bị từ chối
Bước kiểm tra nằm trước `generateAuthTokens` và `updateRefeshToken`, nên request bị từ chối không làm thay đổi DB.

### 3. Mã lỗi 403
Giữ đúng mã mà luồng đăng nhập dùng cho tài khoản bị khóa. Client Flutter (`frontend/lib/core/network/api_client.dart`) gọi refresh bằng một Dio riêng. Nó bắt mọi lỗi trong `_getValidAccessToken` (L101-103), trả về `null`, rồi gọi `_logout()` (L53-54). Vì vậy 401 hay 403 đều dẫn tới đăng xuất, không cần sửa client.

## Risks / Trade-offs

- [App không hiển thị câu "Tài khoản bị khóa" khi refresh bị từ chối, vì `_logout()` mở `LoginPhoneScreen` mà không truyền thông báo] → Chấp nhận trong change này. Khi user đăng nhập lại, luồng login vẫn báo "Tài khoản bị khóa". Hiển thị thông báo ngay trên app là việc của client, để change khác.
- [Hàm cùng tên ở `admin/merchant/sandbox/user/auth/auth.repository.js` vẫn chưa kiểm tra status] → Ngoài phạm vi theo quyết định của người dùng. Hai module độc lập nên không ảnh hưởng nhau.
- [Access token cũ vẫn dùng được tối đa 15 phút sau khi khóa] → Đã biết, ngoài phạm vi (proposal.md - Ngoài phạm vi).

