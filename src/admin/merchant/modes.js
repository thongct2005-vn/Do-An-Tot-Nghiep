
const {
  validateCallbackUrlForSave,
  validateCallbackUrlSyntax,
} = require("../../utils/urlGuard");
const { httpError } = require("../../utils/httpError");

module.exports = {
  production: {
    // Validate đầy đủ (chặn IP nội bộ, resolve DNS...)
    validateCallbackUrl: (url) => validateCallbackUrlForSave(url),
    // Câu chữ trong thông báo lỗi giới hạn số tiền
    paymentVerb: "nhận",
  },
  sandbox: {
    // Chỉ kiểm tra cú pháp URL, không resolve DNS (nhẹ hơn production)
    validateCallbackUrl: async (url) => {
      try {
        validateCallbackUrlSyntax(url);
      } catch (e) {
        throw httpError(400, e.message);
      }
      return url;
    },
    paymentVerb: "chuyển",
  },
};