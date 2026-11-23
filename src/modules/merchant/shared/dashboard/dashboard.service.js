// dashboard.service.js: Factory service quản lý hồ sơ, callback URL và vòng đời khóa API cho Merchant.
const {
  generateUniqueMerchantApiKey,
  generateUniqueMerchantSecretKey,
} = require("../../../../utils/security/keys");
const { httpError } = require("../../../../utils/common/http");

function createDashboardService({ dashboardRepository, validateCallbackUrl }) {
  return {
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
      const safeCallbackUrl = await validateCallbackUrl(callbackUrl);
      await dashboardRepository.updateCallBackUrl({
        userId,
        callbackUrl: safeCallbackUrl,
      });
    },

    async resetApiKey(userId) {
      if (!userId) {
        throw httpError(400, "Thiếu thông tin người dùng");
      }
      const apiKey = await generateUniqueMerchantApiKey();
      return await dashboardRepository.resetApiKey({ userId, apiKey });
    },

    async issueCredentials(userId) {
      if (!userId) {
        throw httpError(400, "Thiếu thông tin người dùng");
      }
      const [apiKey, secretKey] = await Promise.all([
        generateUniqueMerchantApiKey(),
        generateUniqueMerchantSecretKey(),
      ]);
      return await dashboardRepository.issueCredentials({
        userId,
        apiKey,
        secretKey,
      });
    },

    async resetSecretKey(userId) {
      if (!userId) {
        throw httpError(400, "Thiếu thông tin người dùng");
      }
      const secretKey = await generateUniqueMerchantSecretKey();
      return await dashboardRepository.resetSecretKey({ userId, secretKey });
    },
  };
}

module.exports = createDashboardService;