const merchantFeeService = require("./fee.service");
const { successResponse } = require("../../../../utils/apiResponse");

const merchantFeeController = {
  async getPublicFeePlans(req, res, next) {
    try {
      const result = await merchantFeeService.getPublicFeePlans();
      return successResponse(
        res,
        200,
        "Lấy danh sách gói thu phí thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async getFeePlanStatus(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await merchantFeeService.getFeePlanStatus(userId);
      return successResponse(
        res,
        200,
        "Lấy thông tin gói thu phí thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async previewFee(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const {
        transaction_type: transactionType = "WITHDRAW",
        amount,
        destination_user_id: destinationUserId,
        merchant_user_id: merchantUserId,
      } = req.body || {};
      const result = await merchantFeeService.previewTransactionFee({
        transactionType,
        amount,
        actorUser: { id: userId, role: "MERCHANT" },
        merchantUserId: destinationUserId || merchantUserId || null,
        role: "MERCHANT",
      });
      return successResponse(
        res,
        200,
        "Tính trước phí giao dịch merchant thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async getWithdrawQuota(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const quota = await merchantFeeService.getWithdrawQuotaStatus(userId, {
        role: "MERCHANT",
      });
      return successResponse(
        res,
        200,
        "Lấy hạn mức rút miễn phí trong tháng thành công",
        {
          month_key: quota.month_key,
          month: quota.month,
          quota_per_month: quota.quota_per_month,
          already_withdrawn: quota.already_withdrawn,
          remaining_free_quota: quota.remaining_free_quota,
          withdraw_fee_bps: quota.withdraw_fee_bps,
          withdraw_fee_percent: quota.withdraw_fee_percent,
        },
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = merchantFeeController;

