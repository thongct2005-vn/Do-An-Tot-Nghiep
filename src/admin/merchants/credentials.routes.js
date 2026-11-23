// credentials.routes.js: Khai báo route quản trị khóa tích hợp API Merchant.
const router = require("express").Router({ mergeParams: true });
const adminCredentialsController = require("./credentials.controller");

router.use(adminCredentialsController.validateMerchantParam);
router.get("/", adminCredentialsController.getCredentials);
for (const operation of ["rotate", "revoke", "reissue"]) {
  router.post(`/${operation}`, (req, res, next) =>
    adminCredentialsController.mutateCredential(req, res, next, operation),
  );
}

module.exports = {
  router,
  history: adminCredentialsController.history,
};
