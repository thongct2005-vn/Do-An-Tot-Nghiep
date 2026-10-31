const QRCode = require("qrcode");
const { successResponse } = require("../../utils/apiResponse");
const { httpError } = require("../../utils/httpError");
const paymentPageRepository = require("./paymentPage.repository");
const { decryptSecretKey } = require("../../utils/hashSecretKey");
const { buildSignedReturnUrl } = require("../../utils/returnUrl");

// reference_code sinh từ bảng chữ cái chữ + số (xem generateReferenceCode)
const REFERENCE_PATTERN = /^[A-Za-z0-9]{8,64}$/;

function signReturnUrl(row, status) {
  try {
    return buildSignedReturnUrl({
      returnUrl: row.return_url,
      secretKey: decryptSecretKey(row.merchant_secret_key),
      paymentId: row.id,
      orderId: row.order_id,
      amount: Number(row.amount),
      status,
      paidAt: row.paid_at,
    });
  } catch (e) {
    // Không ký được thì không cho quay về, tuyệt đối không gửi link chưa ký.
    console.error("[pay] không ký được return_url:", e.message);
    return null;
  }
}

const paymentPageController = {
  /**
   * GET /api/v2/pay/:referenceCode[?qr=1]
   * Trang thanh toán gọi API này mỗi vài giây để biết trạng thái.
   * Chỉ lần đầu mới xin ảnh QR (?qr=1) để các lần hỏi sau nhẹ.
   */
  async getPaymentForPage(req, res, next) {
    try {
      const referenceCode = req.params.referenceCode;
      if (!REFERENCE_PATTERN.test(referenceCode)) {
        throw httpError(404, "Không tìm thấy đơn thanh toán");
      }
      const row =
        await paymentPageRepository.findByReferenceCode(referenceCode);
      if (!row) throw httpError(404, "Không tìm thấy đơn thanh toán");

      const status = row.status.toLowerCase();

      // Chỉ trả những gì trang cần để hiển thị. KHÔNG trả return_url gốc
      // (có thể chứa token/mã nội bộ của merchant) và không trả secret.
      const data = {
        order_id: row.order_id,
        merchant_name: row.merchant_name,
        amount: Number(row.amount),
        description: row.description ?? null,
        status,
        seconds_left: row.seconds_left,
      };

      // Khi đơn đã có kết quả mới đưa ra link quay về, đã ký bằng secret key của merchant.
      if (status !== "pending" && row.return_url) {
        const redirectUrl = signReturnUrl(row, status);
        if (redirectUrl) {
          data.redirect_url = redirectUrl;
          data.redirect_host = new URL(redirectUrl).host;
        }
      }

      if (status === "pending" && req.query.qr === "1") {
        // Nội dung QR giống luồng QR hiện có: app ví quét ra reference_code
        data.qr_image = await QRCode.toDataURL(referenceCode, {
          width: 300,
          margin: 2,
          errorCorrectionLevel: "M",
        });
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