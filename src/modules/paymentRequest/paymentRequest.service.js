// paymentRequest.service.js: Nghiệp vụ tạo và giải mã mã QR tĩnh / QR động cho người dùng.
const paymentRequestRepository = require("./paymentRequest.repository");
const walletRepository = require("../wallet/wallet.repository");
const { generateReferenceCode } = require("../../utils/payment/qrAndRef");
const { uuidv7 } = require("uuidv7");
const userRepository = require("../user/user.repository");
const { httpError } = require("../../utils/common/http");
const { parseAmountInRange } = require("../../utils/common/amount");
const { getEffectiveTransactionLimit } = require("../../utils/limits/limitsDb");
const pool = require("../../config/database");
const {
  STATIC_QR_TOKEN_REGEX,
  DYNAMIC_QR_REFERENCE_REGEX,
  assertQrDescription,
} = require("./paymentRequest.helpers");

const paymentRequestService = {
  async createStaticQRToken(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để tạo mã QR");
    }
    const token =
      await paymentRequestRepository.getStaticQRTokenByUserId(userId);
    if (token) return token;

    let newToken;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        newToken = `LumaPay:${generateReferenceCode(16)}`;
        await paymentRequestRepository.setStaticQRTokenForUser({
          userId,
          newToken,
        });
        return newToken;
      } catch (err) {
        if (err.constraint === "users_static_qr_token_key") continue;
        throw err;
      }
    }
    throw httpError(500, "Không thể tạo mã QR, vui lòng thử lại");
  },

  async getUserAndWalletByStaticQRToken({ token, requestingUserId }) {
    if (!token) {
      throw httpError(400, "Thiếu mã QR để tra cứu");
    }
    if (!STATIC_QR_TOKEN_REGEX.test(String(token).trim())) {
      throw httpError(404, "Mã QR không hợp lệ");
    }
    const result =
      await paymentRequestRepository.getUserAndWalletByStaticQRToken(token);
    if (!result) {
      throw httpError(404, "Mã QR không hợp lệ");
    }
    if (result.user_status !== "ACTIVE") {
      throw httpError(400, "Tài khoản không khả dụng");
    }
    if (result.user_id === requestingUserId) {
      throw httpError(400, "Không thể chuyển tiền cho chính mình");
    }
    return result;
  },

  async createDynamicQRToken({ userId, amount, description }) {
    if (!userId || !amount) {
      throw httpError(400, "Thiếu thông tin để tạo mã QR");
    }

    const qrRule = await getEffectiveTransactionLimit(pool, {
      userId,
      role: "USER",
      transactionType: "TRANSFER",
    });
    const numAmount = parseAmountInRange(amount, qrRule, "nhận");
    assertQrDescription(description);

    const { id: destinationUserId } =
      await walletRepository.getWalletBalanceByUserId(userId);
    if (!destinationUserId) {
      throw httpError(404, "Không tìm thấy người dùng này");
    }
    const id = uuidv7();
    const referenceCode = generateReferenceCode(16);
    return await paymentRequestRepository.insertPaymentRequest({
      id,
      referenceCode,
      destinationUserId,
      amount: numAmount,
      description,
    });
  },

  async getUserAndWalletByDynamicQRToken({ referenceCode, requestingUserId }) {
    if (!referenceCode) {
      throw httpError(400, "Thiếu mã QR để tra cứu");
    }
    if (!DYNAMIC_QR_REFERENCE_REGEX.test(String(referenceCode).trim())) {
      throw httpError(404, "Mã QR không hợp lệ");
    }

    const result =
      await paymentRequestRepository.findByReferenceCode(referenceCode);
    if (!result) {
      throw httpError(404, "Mã QR không hợp lệ");
    }

    if (result.status !== "PENDING") {
      throw httpError(
        409,
        result.role === "MERCHANT"
          ? "Đơn không còn chờ thanh toán. Vui lòng yêu cầu cửa hàng tạo đơn mới."
          : "Mã QR đã được sử dụng",
      );
    }
    if (result.is_expires) {
      throw httpError(400, "Mã QR đã hết hạn");
    }

    if (result.paid_at != null) {
      throw httpError(400, "Mã QR đã được sử dụng");
    }

    const user = await userRepository.getUserByUserId(
      result.destination_user_id,
    );

    if (user.user_status !== "ACTIVE") {
      throw httpError(400, "Tài khoản không khả dụng");
    }
    if (result.destination_user_id === requestingUserId) {
      throw httpError(400, "Không thể chuyển tiền cho chính mình");
    }
    return {
      id: result.id,
      reference_code: result.reference_code,
      destination_user_id: result.destination_user_id,
      destination_name: result.destination_name,
      destination_phone: result.destination_phone,
      role: result.role,
      amount: result.amount,
      description: result.description,
      order_id: result.order_id,
      status: result.status,
      expires_at: result.expires_at,
      is_expires: result.is_expires,
      paid_at: result.paid_at,
      created_at: result.created_at,
    };
  },
};

module.exports = paymentRequestService;
