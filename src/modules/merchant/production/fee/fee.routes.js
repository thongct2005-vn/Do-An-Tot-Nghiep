const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../../middlewares/auth.middleware");
const merchantFeeController = require("./fee.controller");

/**
 * GET /api/v2/merchant/fee/plans
 * API công khai (Public): Lấy danh sách các gói cước và biểu phí mặc định của hệ thống.
 * Phục vụ hiển thị bảng giá/biểu phí trên trang chủ (Landing Page) cho khách vãng lai hoặc đối tác tham khảo.
 */
router.get("/plans", merchantFeeController.getPublicFeePlans);

/**
 * GET /api/v2/merchant/fee/
 * API nội bộ Merchant: Lấy thông tin chi tiết trạng thái biểu phí của Merchant đang đăng nhập.
 * Bao gồm:
 * - Doanh số nhận QR tích lũy trong tháng hiện tại và bậc thang phí đang áp dụng.
 * - Biểu phí có hiệu lực (tỷ lệ % các bậc thang, sàn min_fee, trần max_fee, phí chuyển P2P).
 * - Lịch biểu phí sắp tới do Admin cấu hình (nếu có hiệu lực từ tháng sau).
 * - Hạn mức và tiến trình rút tiền miễn phí trong tháng (ví dụ: đã rút 15tr / 50tr).
 * Phục vụ tab "Thông tin thu phí" trên Merchant Web Dashboard.
 */
router.get(
  "/",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  merchantFeeController.getFeePlanStatus,
);

/**
 * POST /api/v2/merchant/fee/preview
 * API nội bộ Merchant: Tính toán xem trước (preview / dry-run) tiền phí giao dịch.
 * Hoàn toàn không trừ tiền hay thay đổi dữ liệu trong database.
 * Hỗ trợ tính trước:
 * - WITHDRAW: Phí rút tiền về ngân hàng (tách phần nằm trong hạn mức miễn phí và phần vượt hạn mức chịu phí).
 * - TRANSFER: Phí chuyển tiền P2P chiều đi của Merchant và phí nhận QR inbound nếu chuyển sang ví Merchant khác.
 * Phục vụ hiển thị tức thời tiền phí và tổng tiền trừ ví trên Modal Rút tiền / Chuyển tiền trước khi gửi OTP.
 */
router.post(
  "/preview",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  merchantFeeController.previewFee,
);

/**
 * GET /api/v2/merchant/fee/withdraw-quota
 * API nội bộ Merchant: Tra cứu hạn mức rút tiền miễn phí trong tháng hiện tại.
 * Trả về:
 * - Hạn mức rút miễn phí mỗi tháng (quota_per_month, mặc định 50.000.000đ).
 * - Tổng tiền đã rút trong tháng (already_withdrawn).
 * - Số tiền còn lại được rút miễn phí (remaining_free_quota).
 * - Tỷ lệ % phí sẽ thu trên phần tiền vượt hạn mức (withdraw_fee_percent, mặc định 0.5%).
 * Phục vụ hiển thị thông tin hạn mức khi Merchant mở form Rút tiền về ngân hàng liên kết.
 */
router.get(
  "/withdraw-quota",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  merchantFeeController.getWithdrawQuota,
);

module.exports = router;

