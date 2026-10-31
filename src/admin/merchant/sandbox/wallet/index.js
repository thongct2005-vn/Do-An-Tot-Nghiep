const createWalletModule = require("../../shared/wallet");
const authMiddleware = require("../../../../middlewares/auth.middleware");
const userRepository = require("../../../../modules/user/user.repository");
const { httpError } = require("../../../../utils/httpError");
const { parseAmountInRange } = require("../../../../utils/amount");
const { AMOUNT } = require("../../../../config/limits");
const pool = require("../../../../config/database");
const { successResponse } = require("../../../../utils/apiResponse");

module.exports = () => {
  const { repository, service, controller, router } = createWalletModule();

  repository.updateWalletBalance = async ({ phone, amount }) => {
    await pool.query(`UPDATE users SET balance = $1 WHERE phone = $2`, [
      amount,
      phone,
    ]);
  };

  service.updateWalletBalance = async ({ phone, amount }) => {
    if (!phone || amount === undefined || amount === null || amount === "") {
      throw httpError(400, "Thiếu số điện thoại hoặc số tiền");
    }

    const numAmount = parseAmountInRange(
      amount,
      AMOUNT.SANDBOX_TOPUP,
      "cập nhật",
    );

    const user = await userRepository.findUserByPhone(phone);
    if (!user) {
      throw httpError(404, "Không tìm thấy tài khoản này");
    }

    await repository.updateWalletBalance({ phone, amount: numAmount });
  };

  controller.updateWalletBalance = async (req, res, next) => {
    try {
      const { phone, amount } = req.body;
  
      await service.updateWalletBalance({ phone, amount });
      return successResponse(res, 200, "Cập nhật số dư thành công");
    } catch (e) {
      next(e);
    }
  };

  router.patch(
    "/balance",
    authMiddleware.verifyAccessToken,
    authMiddleware.requireRole("MERCHANT"),
    controller.updateWalletBalance,
  );

  return router;
};