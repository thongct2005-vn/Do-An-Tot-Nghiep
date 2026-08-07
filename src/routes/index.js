const express = require('express');
const router = express.Router();
const authRoutes = require('../modules/auth/auth.routes');
const otpRoutes = require('../modules/otp/otp.routes');
const walletRoutes = require('../modules/wallet/wallet.routes');
const userRoutes = require('../modules/user/user.routes');
const transactionRoutes = require('../modules/transaction/transaction.routes');

router.use('/auth', authRoutes);
router.use('/otp', otpRoutes);
router.use('/wallet', walletRoutes);
router.use('/user', userRoutes);
router.use('/transaction', transactionRoutes);
module.exports = router;
