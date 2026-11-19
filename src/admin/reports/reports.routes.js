const router = require('express').Router();
const auth = require('../../middlewares/auth.middleware');
const session = require('../auth/adminSession.middleware');
const service = require('./reports.service');
const { successResponse } = require('../../utils/apiResponse');
router.use(auth.verifyAccessToken, auth.requireRole('ADMIN'), session);
for (const path of ['overview', 'timeseries', 'breakdown', 'payment-requests']) {
  router.get(`/${path}`, async (req, res, next) => {
    try { return successResponse(res, 200, 'Báo cáo phí Merchant', await service.report(req.query)); }
    catch (e) { next(e); }
  });
}
router.get('/growth', async (req, res, next) => {
  try { return successResponse(res, 200, 'Tăng trưởng theo kỳ', await service.growth(req.query)); }
  catch (e) { next(e); }
});
router.get('/logins', async (req, res, next) => {
  try { return successResponse(res, 200, 'Đăng nhập Mobile App', await service.logins(req.query)); }
  catch (e) { next(e); }
});
router.get('/export', async (req, res, next) => {
  try {
    const { buffer, fileName } = await require('./financialReport.service').exportFinancialReport(req.query, req.user.user_id);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${fileName}"`);
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(buffer));
  } catch (e) { next(e); }
});
module.exports = router;
