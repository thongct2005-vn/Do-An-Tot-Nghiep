const {
  validateCallbackUrlSyntax,
  validateReturnUrlForSave,
} = require("../../../../utils/urlGuard");
const paymentMerchantRequestRepository = require("./paymentRequest.repository");
const walletRepository = require("../../../../modules/wallet/wallet.repository");
const {
  generateReferenceCode,
} = require("../../../../utils/generateReferenceCode");
const { uuidv7 } = require("uuidv7");
const QRCode = require("qrcode");
const { httpError } = require("../../../../utils/httpError");
const MAX_ITEMS = 100;
const { AMOUNT } = require("../../../../config/limits");
const { parseAmountInRange } = require("../../../../utils/amount");
function normalizeItems(items) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items) || items.length > MAX_ITEMS) {
    throw httpError(
      400,
      `Danh sách sản phẩm phải là mảng và tối đa ${MAX_ITEMS} phần tử`,
    );
  }
  return items.map((item, index) => {
    const position = index + 1;
    if (!item || typeof item !== "object") {
      throw httpError(400, `Sản phẩm thứ ${position} không hợp lệ`);
    }
    const productId =
      typeof item.product_id === "string" ? item.product_id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const description = item.description ?? null;
    if (!productId || productId.length > 100) {
      throw httpError(
        400,
        `Mã sản phẩm thứ ${position} phải từ 1 đến 100 ký tự`,
      );
    }
    if (!name || name.length > 255) {
      throw httpError(
        400,
        `Tên sản phẩm thứ ${position} phải từ 1 đến 255 ký tự`,
      );
    }
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100000
    ) {
      throw httpError(
        400,
        `Số lượng sản phẩm thứ ${position} phải là số nguyên từ 1 đến 100000`,
      );
    }
    if (!Number.isInteger(item.unit_price) || item.unit_price < 0) {
      throw httpError(
        400,
        `Đơn giá sản phẩm thứ ${position} phải là số nguyên không âm`,
      );
    }
    if (
      description !== null &&
      (typeof description !== "string" || description.length > 255)
    ) {
      throw httpError(400, `Mô tả sản phẩm thứ ${position} tối đa 255 ký tự`);
    }
    return {
      id: uuidv7(),
      productId,
      name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      description,
    };
  });
}

function normalizeCallbackUrl(callbackUrl) {
  if (callbackUrl === undefined || callbackUrl === null) return null;
  if (typeof callbackUrl !== "string") {
    throw httpError(400, "Callback URL không hợp lệ");
  }
  const trimmed = callbackUrl.trim();
  if (!trimmed) return null;
  if (trimmed.length > 100) {
    throw httpError(400, "Callback URL tối đa 100 ký tự");
  }
  try {
    validateCallbackUrlSyntax(trimmed);
  } catch (e) {
    throw httpError(400, e.message);
  }
  return trimmed;
}

async function normalizeReturnUrl(returnUrl) {
  if (returnUrl === undefined || returnUrl === null) return null;
  if (typeof returnUrl !== "string") {
    throw httpError(400, "Return URL không hợp lệ");
  }
  const trimmed = returnUrl.trim();
  if (!trimmed) return null;
  // ALLOW_PRIVATE_RETURN_URL != "true": http/https, production bắt buộc https,
  // không user:pass, không localhost / IP nội bộ, tên miền phải ra IP công khai.
  return validateReturnUrlForSave(trimmed);
}

const paymentMerchantRequestService = {
  async createDynamicQRToken({
    userId,
    amount,
    description,
    orderId,
    items,
    callbackUrl,
    returnUrl,
    baseUrl,
  }) {
    if (!userId || !amount || !orderId) {
      throw httpError(400, "Thiếu thông tin để tạo mã QR");
    }

    const numAmount = parseAmountInRange(amount, AMOUNT.QR_PAYMENT, "chuyển");

    if (description !== undefined && description !== null) {
      if (typeof description !== "string" || description.length > 50) {
        throw httpError(400, "Mô tả quá dài");
      }
    }
    const normalizedItems = normalizeItems(items);
    const normalizedCallbackUrl = normalizeCallbackUrl(callbackUrl);
    const normalizedReturnUrl = await normalizeReturnUrl(returnUrl);
    const { id: destinationUserId } =
      await walletRepository.getWalletBalanceByUserId(userId);
    if (!destinationUserId) {
      throw httpError(404, "Không tìm thấy người dùng này");
    }
    const id = uuidv7();
    const referenceCode = generateReferenceCode(16);
    const qrImage = await QRCode.toDataURL(referenceCode, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: "M",
    });
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
      });
    // Redirect flow: merchant chuyển khách sang trang thanh toán của cổng
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
      transaction_id: payment.transaction_id ?? null,
      paid_at: payment.paid_at ?? null,
      created_at: payment.created_at,
      expires_at: payment.expires_at,
    };
  },
};
module.exports = paymentMerchantRequestService;
