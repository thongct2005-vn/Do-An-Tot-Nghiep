const express = require("express");
const router = express.Router();
const adminMerchantsController = require("./merchants.controller");
const authMiddleware = require("../../middlewares/auth.middleware");
const requireCurrentAdminSession = require("../auth/adminSession.middleware");

router.use(authMiddleware.verifyAccessToken);
router.use(authMiddleware.requireRole("ADMIN"));
router.use(requireCurrentAdminSession);
router.use('/:id/credentials', require('./credentials.routes').router);
router.get('/:id/audit-logs', require('./credentials.routes').history);

router.get("/fee-config/default", adminMerchantsController.getDefaultFeeConfig);
router.post("/fee-config/default/preview", adminMerchantsController.previewDefaultFeeConfig);
router.put("/fee-config/default", adminMerchantsController.updateDefaultFeeConfig);
router.get("/fee-config/history", adminMerchantsController.getFeeConfigHistory);

router.get("/", adminMerchantsController.getMerchants);
router.get("/:id/fee-config", adminMerchantsController.getMerchantFeeConfig);
router.get("/:id", adminMerchantsController.getMerchantDetail);
router.patch("/:id/status", adminMerchantsController.updateMerchantStatus);
router.patch("/:id/profile", adminMerchantsController.updateMerchantProfile);

module.exports = router;

