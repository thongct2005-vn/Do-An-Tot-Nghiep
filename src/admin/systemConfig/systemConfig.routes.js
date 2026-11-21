const express = require("express");
const authMiddleware = require("../../middlewares/auth.middleware");
const requireCurrentAdminSession = require("../auth/adminSession.middleware");
const adminSystemConfigController = require("./systemConfig.controller");

const router = express.Router();

router.use(authMiddleware.verifyAccessToken);
router.use(authMiddleware.requireRole("ADMIN"));
router.use(requireCurrentAdminSession);

router.get("/", adminSystemConfigController.listConfigs);
router.get("/history", adminSystemConfigController.getConfigHistory);
router.get("/:key", adminSystemConfigController.getConfig);
router.post("/:key/preview", adminSystemConfigController.previewConfigUpdate);
router.put("/:key", adminSystemConfigController.updateConfig);

module.exports = router;
