const paymentRequestRepository = require("./paymentRequest.repository");
const walletRepository = require("../wallet/wallet.repository");
const { generateReferenceCode } = require("../../utils/generateReferenceCode");
const { uuidv7 } = require("uuidv7");
const userRepository = require("../user/user.repository");
const paymentRequestService = {
  async createStaticQRToken(userId) {
    if (!userId) {
      const err = new Error("Thiếu thông tin để tạo mã QR");
      err.statusCode = 400;
      throw err;
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
    const err = new Error("Không thể tạo mã QR, vui lòng thử lại");
    err.statusCode = 500;
    throw err;
  },

  async getUserAndWalletByStaticQRToken({ token, requestingUserId }) {
    if (!token) {
      const err = new Error("Thiếu token để lấy thông tin");
      err.statusCode = 400;
      throw err;
    }
    const result =
      await paymentRequestRepository.getUserAndWalletByStaticQRToken(token);
    if (!result) {
      const err = new Error("Mã QR không hợp lệ");
      err.statusCode = 404;
      throw err;
    }
    if (result.user_status !== "ACTIVE" || result.wallet_status !== "ACTIVE") {
      const err = new Error("Tài khoản không khả dụng");
      err.statusCode = 400;
      throw err;
    }
    if (result.user_id === requestingUserId) {
      const err = new Error("Không thể chuyển tiền cho chính mình");
      err.statusCode = 400;
      throw err;
    }
    return result;
  },

  async createDynamicQRToken({ userId, amount, description }) {
    if (!userId || !amount) {
      const err = new Error("Thiếu thông tin để tạo mã QR");
      err.statusCode = 400;
      throw err;
    }
    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 1000 ||
      numAmount > 50000000
    ) {
      const err = new Error(
        "Số tiền chuyển phải từ 1 nghìn và tối đa là 50 triệu",
      );
      err.statusCode = 400;
      throw err;
    }
    if (description !== undefined && description !== null) {
      if (typeof description !== "string" || description.length > 50) {
        const err = new Error("Mô tả tối đa 50 ký tự");
        err.statusCode = 400;
        throw err;
      }
    }
    const { id: destinationWalletId, user_id: destinationUserId } =
      await walletRepository.getWalletByUserId(userId);
    if (!destinationWalletId || !destinationUserId) {
      const err = new Error(
        "Không tìm thấy người dùng hoặc ví của người dùng này",
      );
      err.statusCode = 404;
      throw err;
    }
    const id = uuidv7();
    const referenceCode = generateReferenceCode(16);
    const result = await paymentRequestRepository.insertPaymentRequest({
      id,
      referenceCode,
      destinationUserId,
      destinationWalletId,
      amount: numAmount,
      description,
    });
    return result;
  },

  async getUserAndWalletByDynamicQRToken({ referenceCode, requestingUserId }) {
    if (!referenceCode) {
      const err = new Error("Thiếu token để lấy thông tin");
      err.statusCode = 400;
      throw err;
    }

    const result =
      await paymentRequestRepository.findByReferenceCode(referenceCode);
    if (!result) {
      const err = new Error("Mã QR không hợp lệ");
      err.statusCode = 404;
      throw err;
    }

    if (result.is_expires) {
      const err = new Error("Mã QR đã hết hạn");
      err.statusCode = 400;
      throw err;
    }

    if (result.paid_at != null) {
      const err = new Error("Mã QR đã được sử dụng");
      err.statusCode = 400;
      throw err;
    }

    const user = await userRepository.getUserAndWalletByUserId(
      result.destination_user_id,
    );

    if (user.user_status !== "ACTIVE" || user.wallet_status !== "ACTIVE") {
      const err = new Error("Tài khoản không khả dụng");
      err.statusCode = 400;
      throw err;
    }
    if (result.destination_user_id === requestingUserId) {
      const err = new Error("Không thể chuyển tiền cho chính mình");
      err.statusCode = 400;
      throw err;
    }

    return result;
  },
};
module.exports = paymentRequestService;
