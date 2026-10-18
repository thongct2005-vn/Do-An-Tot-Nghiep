const paymentMerchantRequestRepository = require("./paymentRequest.repository");
const walletRepository = require("../../../modules/wallet/wallet.repository");
const { generateReferenceCode } = require("../../../utils/generateReferenceCode");
const { uuidv7 } = require("uuidv7");
const QRCode = require("qrcode");
const { httpError } = require("../../../utils/httpError");
const paymentMerchantRequestService = {
  async createDynamicQRToken({ userId, amount, description, orderId }) {
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
      });
    return { ...result, qr_image: qrImage };
  },
};
module.exports = paymentMerchantRequestService;