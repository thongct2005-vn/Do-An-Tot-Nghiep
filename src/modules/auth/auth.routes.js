const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const authMiddleware =require('../../middlewares/auth.middleware')

router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/checkPhoneExists', authController.isPhoneExist);
router.get('/me', authMiddleware.verifyAccessToken, authController.getMe);
router.post('/refresh-token',authMiddleware.verifyRefreshToken, authController.refreshToken);
module.exports = router;