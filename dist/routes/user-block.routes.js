//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _express = require("express");
const _userblockcontroller = require("../controllers/user-block.controller");
const _authmiddleware = require("../middleware/auth.middleware");
const router = (0, _express.Router)();
// Block a user
router.post('/block', _authmiddleware.protect, _userblockcontroller.userBlockController.blockUser);
// Unblock a user
router.post('/unblock', _authmiddleware.protect, _userblockcontroller.userBlockController.unblockUser);
// Get list of blocked users
router.get('/blocked', _authmiddleware.protect, _userblockcontroller.userBlockController.getBlockedUsers);
// Get list of users who blocked you
router.get('/blocked-by', _authmiddleware.protect, _userblockcontroller.userBlockController.getBlockedByUsers);
// Check block status between two users
router.get('/status/:otherUserId', _authmiddleware.protect, _userblockcontroller.userBlockController.checkBlockStatus);
const _default = router;

//# sourceMappingURL=user-block.routes.js.map