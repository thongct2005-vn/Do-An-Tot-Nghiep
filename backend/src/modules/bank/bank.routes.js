const express = require("express");
const router = express.Router();
const bankController = require('./bank.controller');
const authMiddleware = require("../../middlewares/auth.middleware");

router.get("/status", authMiddleware.verifyAccessToken,bankController.getBankLinkStatus);
router.post("/link", authMiddleware.verifyAccessToken, bankController.linkBankAccount);
module.exports = router;
