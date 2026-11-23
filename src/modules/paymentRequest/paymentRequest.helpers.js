// paymentRequest.helpers.js: Biểu thức chính quy và kiểm tra mô tả QR dùng chung cho PaymentRequest.
const { httpError } = require("../../utils/common/http");

const STATIC_QR_TOKEN_REGEX = /^(?:LumaPay|Mio):[A-Za-z0-9]{8,64}$/;
const DYNAMIC_QR_REFERENCE_REGEX = /^[A-Za-z0-9]{8,64}$/;

function assertQrDescription(description, maxLen = 50) {
  if (description !== undefined && description !== null) {
    if (typeof description !== "string" || description.length > maxLen) {
      throw httpError(400, "Mô tả quá dài");
    }
  }
}

module.exports = {
  STATIC_QR_TOKEN_REGEX,
  DYNAMIC_QR_REFERENCE_REGEX,
  assertQrDescription,
};

