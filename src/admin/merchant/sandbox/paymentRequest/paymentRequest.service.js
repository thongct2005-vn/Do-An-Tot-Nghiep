const paymentMerchantRequestRepository = require("./paymentRequest.repository");
const walletRepository = require("../../../../modules/wallet/wallet.repository");
const {
  generateReferenceCode,
} = require("../../../../utils/generateReferenceCode");
const { uuidv7 } = require("uuidv7");
const QRCode = require("qrcode");
const { httpError } = require("../../../../utils/httpError");
const MAX_ITEMS = 100;

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
      throw httpError(
        400,
        `Mô tả sản phẩm thứ ${position} tối đa 255 ký tự`,
      );
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
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    throw httpError(400, "Callback URL không hợp lệ");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw httpError(400, "Callback URL phải bắt đầu bằng http hoặc https");
  }
  return trimmed;
}

const paymentMerchantRequestService = {
  async createDynamicQRToken({
    userId,
    amount,
    description,
    orderId,
    items,
    callbackUrl,
  }) {
    if (!userId || !amount || !orderId) {
      throw httpError(400, "Thiếu thông tin để tạo mã QR");
    }
    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 1000 ||
      numAmount > 50000000
    ) {
      throw httpError(400, "Số tiền chuyển phải từ 1 nghìn và tối đa 50 triệu");
    }
    if (description !== undefined && description !== null) {
      if (typeof description !== "string" || description.length > 50) {
        throw httpError(400, "Mô tả tối đa 50 ký tự");
      }
    }
    const normalizedItems = normalizeItems(items);
    const normalizedCallbackUrl = normalizeCallbackUrl(callbackUrl);
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
      });
    return { ...result, qr_image: qrImage };
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

    const STATUS_MAP = {
      PENDING: "pending",
      PAID: "success",
      FAILED: "failed",
    };

    return {
      payment_id: payment.id,
      order_id: payment.order_id,
      amount: Number(payment.amount),
      status:
        STATUS_MAP[payment.status] ?? String(payment.status).toLowerCase(),
      transaction_id: payment.transaction_id ?? null,
      paid_at: payment.paid_at ?? null,
      created_at: payment.created_at,
      expires_at: payment.expires_at,
    };
  },
};
module.exports = paymentMerchantRequestService;