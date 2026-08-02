const express = require("express");
const router = express.Router();
const userController = require("./user.controller");
const authMiddleware = require("../../middlewares/auth.middleware");

router.get(
  "/find-user",
  authMiddleware.verifyAccessToken,
  userController.findUserByPhone,
);
router.post(
  "/check-contact",
  authMiddleware.verifyAccessToken,
  userController.findUserByPhoneList,
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
module.exports = router;
