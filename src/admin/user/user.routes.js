const express = require("express");
const router = express.Router();
const adminUserController = require("./user.controller");
const authMiddleware = require("../../middlewares/auth.middleware");

router.use(authMiddleware.verifyAccessToken);
router.use(authMiddleware.requireRole("ADMIN"));

router.get("/stats", adminUserController.getStats);
router.get("/", adminUserController.getUsers);
router.get("/:id", adminUserController.getUserDetail);
router.patch("/:id/status", adminUserController.updateUserStatus);
router.patch("/:id/profile", adminUserController.updateUserProfile);
router.get("/:id/transactions", adminUserController.getUserTransactions);
router.get("/:id/history", adminUserController.getUserChangeHistory);
router.post("/:id/operations/p2p", adminUserController.executeAdminP2P);

module.exports = router;
