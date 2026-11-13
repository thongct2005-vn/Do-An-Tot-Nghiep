const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../../middlewares/auth.middleware");
const merchantFeeController = require("./fee.controller");

router.get("/plans", merchantFeeController.getPublicFeePlans);

router.get(
  "/",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  merchantFeeController.getFeePlanStatus,
);

router.put(
  "/",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  merchantFeeController.selectFeePlan,
);

router.patch(
  "/",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  merchantFeeController.selectFeePlan,
);

router.delete(
  "/pending",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  merchantFeeController.cancelPendingFeePlan,
);

router.post(
  "/preview",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  merchantFeeController.previewFee,
);

router.get(
  "/withdraw-quota",
  authMiddleware.verifyAccessToken,
  authMiddleware.requireRole("MERCHANT"),
  authMiddleware.requireActiveMerchant,
  merchantFeeController.getWithdrawQuota,
);

module.exports = router;

