// paymentRequest.helpers.js: Chuẩn hóa dữ liệu đơn hàng, callback/return URL và dựng lỗi trùng mã đơn cho Merchant.
const { uuidv7 } = require("uuidv7");
const pool = require("../../../../config/database");
const { httpError } = require("../../../../utils/common/http");
const { validateReturnUrlForSave } = require("../../../../utils/security/url");

const DUPLICATE_ORDER_INDEX = "payment_requests_merchant_order_uk";
const MAX_ITEMS = 100;

async function buildDuplicateOrderError({ merchantId, orderId }) {
  const { rows } = await pool.query(
    `SELECT status, (expires_at <= NOW()) AS is_expired
       FROM payment_requests
      WHERE destination_user_id = $1 AND order_id = $2`,
    [merchantId, orderId],
  );
  const existing = rows[0];
  if (existing && ["SUCCESS", "PAID"].includes(existing.status)) {
    return httpError(409, "Đơn hàng này đã được thanh toán");
  }
  if (existing?.status === "CANCELLED") {
    return httpError(
      409,
      "Đơn đã bị hủy do thay đổi khóa tích hợp. Vui lòng tạo mã đơn hàng mới với khóa mới.",
    );
  }
  if (existing && existing.status === "PENDING" && !existing.is_expired) {
    return httpError(
      409,
      "Đơn hàng này đang chờ thanh toán, vui lòng dùng lại mã thanh toán đã tạo",
    );
  }
  return httpError(
    409,
    "Mã đơn hàng này đã được dùng cho một thanh toán đã hết hạn, vui lòng tạo mã đơn hàng mới",
  );
}

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

async function normalizeCallbackUrl(callbackUrl, validateCallbackUrl) {
  if (callbackUrl === undefined || callbackUrl === null) return null;
  if (typeof callbackUrl !== "string") {
    throw httpError(400, "Callback URL không hợp lệ");
  }
  const trimmed = callbackUrl.trim();
  if (!trimmed) return null;
  if (trimmed.length > 100) {
    throw httpError(400, "Callback URL tối đa 100 ký tự");
  }
  return validateCallbackUrl(trimmed);
}

async function normalizeReturnUrl(returnUrl) {
  if (returnUrl === undefined || returnUrl === null) return null;
  if (typeof returnUrl !== "string") {
    throw httpError(400, "Return URL không hợp lệ");
  }
  const trimmed = returnUrl.trim();
  if (!trimmed) return null;
  return validateReturnUrlForSave(trimmed);
}

module.exports = {
  DUPLICATE_ORDER_INDEX,
  buildDuplicateOrderError,
  normalizeItems,
  normalizeCallbackUrl,
  normalizeReturnUrl,
};

