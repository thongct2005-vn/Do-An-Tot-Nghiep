const express = require("express");
const router = express.Router();
const userController = require("./user.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const {
  contactCheckLimiter,
  findUserLimiter,
  contactDailyQuota,
} = require("../../middlewares/ratelimit.middleware");

router.get(
  "/find-user",
  authMiddleware.verifyAccessToken,
  findUserLimiter,
  userController.findUserByPhone,
);
router.post(
  "/check-contact",
  authMiddleware.verifyAccessToken,
  contactCheckLimiter,
  contactDailyQuota,
  userController.findUserByPhoneHashList,
);

router.get(
  "/pin-status",
  authMiddleware.verifyAccessToken,
  userController.checkPinStatus,
);

router.post(
  "/create-pin",
  authMiddleware.verifyAccessToken,
  userController.createPin,
);

router.patch(
  "/fcm-token",
  authMiddleware.verifyAccessToken,
  userController.updateFcmToken,
);

router.get(
  "/fcm-token",
  authMiddleware.verifyAccessToken,
  userController.getFcmToken,
);

router.patch(
  "/update-pin",
  authMiddleware.verifyAccessToken,
  userController.updatePin,
);

router.patch(
  "/update-password",
  authMiddleware.verifyAccessToken,
  userController.updatePassWord,
);
module.exports = router;
