"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const user_block_controller_1 = require("../controllers/user-block.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Block a user
router.post('/block', auth_middleware_1.protect, user_block_controller_1.userBlockController.blockUser);
// Unblock a user
router.post('/unblock', auth_middleware_1.protect, user_block_controller_1.userBlockController.unblockUser);
// Get list of blocked users
router.get('/blocked', auth_middleware_1.protect, user_block_controller_1.userBlockController.getBlockedUsers);
// Get list of users who blocked you
router.get('/blocked-by', auth_middleware_1.protect, user_block_controller_1.userBlockController.getBlockedByUsers);
// Check block status between two users
router.get('/status/:otherUserId', auth_middleware_1.protect, user_block_controller_1.userBlockController.checkBlockStatus);
exports.default = router;
