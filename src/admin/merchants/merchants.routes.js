const express = require("express");
const router = express.Router();
const adminMerchantsController = require("./merchants.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const requireCurrentAdminSession = require("../auth/adminSession.middleware");

router.use(authMiddleware.verifyAccessToken);
router.use(authMiddleware.requireRole("ADMIN"));
router.use(requireCurrentAdminSession);

router.get("/", adminMerchantsController.getMerchants);
router.get("/:id", adminMerchantsController.getMerchantDetail);

module.exports = router;

