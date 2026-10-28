const QRCode = require("qrcode");
const { successResponse } = require("../../utils/apiResponse");
const { httpError } = require("../../utils/httpError");
const paymentPageRepository = require("./paymentPage.repository");

// reference_code sinh từ bảng chữ cái chữ + số (xem generateReferenceCode)
const REFERENCE_PATTERN = /^[A-Za-z0-9]{8,64}$/;

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

      const data = {
        order_id: row.order_id,
        merchant_name: row.merchant_name,
        amount: Number(row.amount),
        description: row.description ?? null,
        status,
        paid_at: row.paid_at ?? null,
        seconds_left: row.seconds_left,
        return_url: row.return_url ?? null,
      };

      if (status === "pending" && req.query.qr === "1") {
        // Nội dung QR giống luồng QR hiện có: app ví quét ra reference_code
        data.qr_image = await QRCode.toDataURL(referenceCode, {
          width: 300,
          margin: 2,
          errorCorrectionLevel: "M",
        });
      }

      res.set("Cache-Control", "no-store");
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
