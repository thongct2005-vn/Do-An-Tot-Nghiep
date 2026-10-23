const express = require("express");
const router = express.Router();
const kycController = require("./kyc.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const { uploadKycImages } = require("../../middlewares/upload.middleware");

router.get(
  "/check",
  authMiddleware.verifyAccessToken,
  kycController.checkUserKYC,
);
router.post(
  "/verify",
  authMiddleware.verifyAccessToken,
  uploadKycImages,
  kycController.verifyAndSaveKYC,
);

module.exports = router;