const dashboardRepository = require("./dashboard.repository");
const {
  generateUniqueMerchantApiKey,
  generateUniqueMerchantSecretKey,
} = require("../../../../utils/generateApikeySecretkey");
const { httpError } = require("../../../../utils/httpError");

const dashboardService = {
  async getMerchantInfoById(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu mã người dùng để lấy thông tin");
    }
    return await dashboardRepository.getMerchantInfoById(userId);
  },

  async updateCallBackUrl({ userId, callbackUrl }) {
    if (!userId) {
      throw httpError(400, "Thiếu mã người dùng");
    }
    if (!callbackUrl) {
      throw httpError(400, "Thiếu callback");
    }
    await dashboardRepository.updateCallBackUrl({ userId, callbackUrl });
  },

  async resetApiKey(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    const apiKey = await generateUniqueMerchantApiKey();
    return await dashboardRepository.resetApiKey({ userId, apiKey });
  },

  async resetSecretKey(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    const secretKey = await generateUniqueMerchantSecretKey();
    return await dashboardRepository.resetSecretKey({ userId, secretKey });
  },
};

module.exports = dashboardService;
