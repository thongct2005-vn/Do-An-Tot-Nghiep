const express = require('express');
const router = express.Router();
const walletController = require('./wallet.controller');
const authMiddleware = require('../../middlewares/auth.middleware');

router.get('/balance',authMiddleware.verifyAccessToken, walletController.getWalletBalanceByUserId);
router.post('/check-transfer', authMiddleware.verifyAccessToken, walletController.checkTransferEligibility);
module.exports = router;