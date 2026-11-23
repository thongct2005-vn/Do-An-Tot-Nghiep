// reports.routes.js: Khai báo tuyến API báo cáo phí Merchant, tăng trưởng, đăng nhập và xuất Excel Admin.
const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const session = require("../auth/adminSession.middleware");
const adminReportsController = require("./reports.controller");

router.use(auth.verifyAccessToken, auth.requireRole("ADMIN"), session);
for (const path of [
  "overview",
  "timeseries",
  "breakdown",
  "payment-requests",
]) {
  router.get(`/${path}`, adminReportsController.getMerchantReport);
}
router.get("/growth", adminReportsController.getGrowthReport);
router.get("/logins", adminReportsController.getLoginStats);
router.get("/export", adminReportsController.exportFinancialReport);

module.exports = router;
