// paymentRequest.service.js: Factory service tạo đơn QR thanh toán và tra cứu trạng thái hóa đơn cho Merchant.
const walletRepository = require("../../../../modules/wallet/wallet.repository");
const {
  generateReferenceCode,
} = require("../../../../utils/payment/qrAndRef");
const { uuidv7 } = require("uuidv7");
const { httpError } = require("../../../../utils/common/http");
const { parseAmountInRange } = require("../../../../utils/common/amount");
const { getEffectiveTransactionLimit } = require("../../../../utils/limits/limitsDb");
const { generateQrDataUrl } = require("../../../../utils/payment/qrAndRef");
const pool = require("../../../../config/database");
const { assertQrDescription } = require("../../../paymentRequest/paymentRequest.helpers");
const {
  normalizeItems,
  normalizeCallbackUrl,
  normalizeReturnUrl,
} = require("./paymentRequest.helpers");

function createPaymentRequestService({
  paymentMerchantRequestRepository,
  validateCallbackUrl,
  paymentVerb,
}) {
  return {
    async createDynamicQRToken({
      userId,
      amount,
      description,
      orderId,
      items,
      callbackUrl,
      returnUrl,
      baseUrl,
      credentialsRevision,
    }) {
      if (!userId || !amount || !orderId) {
        throw httpError(400, "Thiếu thông tin để tạo mã QR");
      }
      const qrRule = await getEffectiveTransactionLimit(pool, {
        userId,
        role: "MERCHANT",
        transactionType: "QR_PAYMENT",
      });
      const numAmount = parseAmountInRange(amount, qrRule, paymentVerb);
      assertQrDescription(description);

      const normalizedItems = normalizeItems(items);
      const normalizedCallbackUrl = await normalizeCallbackUrl(
        callbackUrl,
        validateCallbackUrl,
      );
      const normalizedReturnUrl = await normalizeReturnUrl(returnUrl);
      const { id: destinationUserId } =
        await walletRepository.getWalletBalanceByUserId(userId);
      if (!destinationUserId) {
        throw httpError(404, "Không tìm thấy người dùng này");
      }
      const id = uuidv7();
      const referenceCode = generateReferenceCode(16);
      const qrImage = await generateQrDataUrl(referenceCode);
      const result =
        await paymentMerchantRequestRepository.insertMerchantPaymentRequest({
          id,
          referenceCode,
          destinationUserId,
          amount: numAmount,
          description,
          orderId,
          items: normalizedItems,
          callbackUrl: normalizedCallbackUrl,
          returnUrl: normalizedReturnUrl,
          credentialsRevision,
        });
      const paymentUrl = `${baseUrl}/pay/${referenceCode}`;
      return { ...result, qr_image: qrImage, payment_url: paymentUrl };
    },

    async findPaymentByOrderId({ orderId, merchantId }) {
      if (!orderId || !merchantId) {
        throw httpError(400, "Thiếu mã hóa đơn hoặc thông tin cửa hàng");
      }
      const payment = await paymentMerchantRequestRepository.findPaymentByOrderId(
        { orderId, merchantId },
      );
      if (!payment) {
        throw httpError(404, "Không tìm thấy đơn hàng");
      }

      return {
        payment_id: payment.id,
        order_id: payment.order_id,
        amount: Number(payment.amount),
        status: payment.status.toLowerCase(),
        ...(payment.status === "CANCELLED"
          ? {
              message:
                "Đơn đã bị hủy. Vui lòng tạo đơn mới bằng credentials hiện tại.",
            }
          : {}),
        transaction_id: payment.transaction_id ?? null,
        paid_at: payment.paid_at ?? null,
        created_at: payment.created_at,
        expires_at: payment.expires_at,
      };
    },
  };
}

module.exports = createPaymentRequestService;
