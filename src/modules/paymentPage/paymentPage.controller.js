// paymentPage.controller.js: Controller xử lý HTTP lấy trạng thái và mã QR cho trang thanh toán công khai.
const { successResponse, httpError } = require("../../utils/common/http");
const { generateQrDataUrl } = require("../../utils/payment/qrAndRef");
const paymentPageRepository = require("./paymentPage.repository");
const {
  PAYMENT_PAGE_REFERENCE_PATTERN,
  signReturnUrl,
} = require("./paymentPage.helpers");

const paymentPageController = {
  async getPaymentForPage(req, res, next) {
    try {
      const referenceCode = req.params.referenceCode;
      if (!PAYMENT_PAGE_REFERENCE_PATTERN.test(referenceCode)) {
        throw httpError(404, "Không tìm thấy đơn thanh toán");
      }
      const row =
        await paymentPageRepository.findByReferenceCode(referenceCode);
      if (!row) throw httpError(404, "Không tìm thấy đơn thanh toán");

      const status = row.status.toLowerCase();

      const data = {
        order_id: row.order_id,
        merchant_name: row.merchant_name,
        amount: Number(row.amount),
        description: row.description ?? null,
        status,
        ...(status === "cancelled"
          ? {
              message:
                "Đơn thanh toán đã bị hủy. Vui lòng yêu cầu cửa hàng tạo đơn mới.",
            }
          : {}),
        seconds_left: row.seconds_left,
      };

      if (status !== "pending" && row.return_url) {
        const redirectUrl = signReturnUrl(row, status);
        if (redirectUrl) {
          data.redirect_url = redirectUrl;
          data.redirect_host = new URL(redirectUrl).host;
        }
      }

      if (status === "pending" && req.query.qr === "1") {
        data.qr_image = await generateQrDataUrl(referenceCode);
      }

      res.set("Cache-Control", "no-store");
      res.set("Referrer-Policy", "no-referrer");
      return successResponse(
        res,
        200,
        "Lấy thông tin thanh toán thành công",
        data,
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = paymentPageController;
