const dashboardRepository = require("./dashboard.repository");
const { httpError } = require("../../../utils/httpError");

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
};

module.exports = dashboardService;
