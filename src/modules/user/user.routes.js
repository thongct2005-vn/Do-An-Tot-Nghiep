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
module.exports = router;
