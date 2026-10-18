const express = require("express");
const router = express.Router();
const adminAuthController = require("./auth.controller");
const { loginLimiter } = require("../../middlewares/ratelimit.middleware");

router.post("/login", loginLimiter, adminAuthController.login);

module.exports = router;
