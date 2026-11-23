// wallet.controller.js: Controller xử lý HTTP cho số dư ví, kiểm tra hạn mức khả dụng và xác thực PIN.
const { successResponse, runWithRiskFailure } = require("../../utils/common/http");
const walletService = require("./wallet.service");
const { clearFailure, recordFailure } = require("../../utils/security/risk");

const walletController = {
  async getWalletByUserId(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await walletService.getWalletByUserId(userId);
      return successResponse(res, 200, "Lấy số dư ví thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async checkTransferEligibility(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { amount } = req.body;
      const result = await walletService.checkTransferEligibility({
        userId,
        amount,
      });
      return successResponse(res, 200, "Kiểm tra số dư thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async checkPin(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { pin, idempotency_key: idempotencyKey, action, params } = req.body;
      const result = await runWithRiskFailure(req.user?.phone, () =>
        walletService.checkPin({
          userId,
          pin,
          idempotencyKey,
          action,
          params,
          riskChallenge: Boolean(req.risk?.challenge),
        }),
      );
      if (result.is_correct === false) {
        recordFailure(req.user?.phone);
      } else if (!result.challenge_required) {
        clearFailure(req.user?.phone);
      }
      return successResponse(res, 200, "Kiểm tra mã PIN thành công", result);
    } catch (e) {
      next(e);
    }
  },
  async verifyPinChallenge(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { otp } = req.body;
      const result = await runWithRiskFailure(req.user?.phone, () =>
        walletService.verifyPinChallenge({
          userId,
          otpUser: req.otpUser,
          otp,
        }),
      );
      clearFailure(req.user?.phone);
      return successResponse(
        res,
        200,
        "Xác thực bảo mật bổ sung thành công",
        result,
      );
    } catch (e) {
      next(e);
    }
  },
  async resendPinChallenge(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const result = await walletService.resendPinChallenge({
        userId,
        otpUser: req.otpUser,
      });
      return successResponse(res, 200, "Đã gửi lại mã OTP xác thực", result);
    } catch (e) {
      next(e);
    }
  },
};

module.exports = walletController;
