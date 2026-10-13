const paymentRequestRepository = require("./paymentRequest.repository");
const walletRepository = require("../wallet/wallet.repository");
const { generateReferenceCode } = require("../../utils/generateReferenceCode");
const { uuidv7 } = require("uuidv7");
const userRepository = require("../user/user.repository");
const { httpError } = require("../../utils/httpError");
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
        newToken = `Mio:${generateReferenceCode(16)}`;
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
      throw httpError(400, "Thiếu token để lấy thông tin");
    }
    const result =
      await paymentRequestRepository.getUserAndWalletByStaticQRToken(token);
    if (!result) {
      throw httpError(404, "Mã QR không hợp lệ");
    }
    if (result.user_status !== "ACTIVE" || result.wallet_status !== "ACTIVE") {
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
    const { id: destinationUserId } =
      await walletRepository.getWalletBalanceByUserId(userId);
    if (!destinationUserId) {
      throw httpError(
        404,
        "Không tìm thấy người dùng này",
      );
    }
    const id = uuidv7();
    const referenceCode = generateReferenceCode(16);
    const result = await paymentRequestRepository.insertPaymentRequest({
      id,
      referenceCode,
      destinationUserId,
      amount: numAmount,
      description,
    });
    return result;
  },

  async getUserAndWalletByDynamicQRToken({ referenceCode, requestingUserId }) {
    if (!referenceCode) {
      throw httpError(400, "Thiếu token để lấy thông tin");
    }

    const result =
      await paymentRequestRepository.findByReferenceCode(referenceCode);
    if (!result) {
      throw httpError(404, "Mã QR không hợp lệ");
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

    if (user.user_status !== "ACTIVE" || user.wallet_status !== "ACTIVE") {
      throw httpError(400, "Tài khoản không khả dụng");
    }
    if (result.destination_user_id === requestingUserId) {
      throw httpError(400, "Không thể chuyển tiền cho chính mình");
    }

    return result;
  },
};
module.exports = paymentRequestService;
