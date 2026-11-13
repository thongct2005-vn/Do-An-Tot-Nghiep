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

  async selectFeePlan(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const feePlan = req.body?.fee_plan;
      const result = await merchantFeeService.selectFeePlan(userId, { feePlan });

      const message =
        result.action === "CANCELLED_PENDING_CHANGE"
          ? `Đã hủy lịch đổi gói thu phí. Bạn tiếp tục áp dụng ${result.current_plan_name}`
          : `Đã chọn ${result.pending_plan_name}. Hiện tại vẫn áp dụng ${result.current_plan_name}, gói mới sẽ áp dụng từ tháng sau (${result.effective_from_date})`;

      return successResponse(res, 200, message, result);
    } catch (e) {
      next(e);
    }
  },

  async cancelPendingFeePlan(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await merchantFeeService.cancelPendingFeePlan(userId);
      return successResponse(
        res,
        200,
        `Đã hủy lịch đổi gói thu phí. Bạn tiếp tục áp dụng ${result.current_plan_name}`,
        result,
      );
    } catch (e) {
      next(e);
    }
  },

  async previewFee(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { transaction_type: transactionType = "WITHDRAW", amount } = req.body || {};
      const result = await merchantFeeService.previewTransactionFee({
        transactionType,
        amount,
        actorUser: { id: userId, role: "MERCHANT" },
        merchantUserId: userId,
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

