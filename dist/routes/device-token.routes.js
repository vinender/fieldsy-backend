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
const _devicetokencontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/device-token.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// All routes require authentication
router.use(_authmiddleware.protect);
/**
 * @route   POST /api/device-tokens
 * @desc    Register a device token for push notifications
 * @access  Private
 * @body    { token: string, platform: "web"|"ios"|"android", deviceName?: string }
 */ router.post('/', _devicetokencontroller.default.registerToken);
/**
 * @route   DELETE /api/device-tokens
 * @desc    Remove a specific device token (logout/unsubscribe)
 * @access  Private
 * @body    { token: string }
 */ router.delete('/', _devicetokencontroller.default.removeToken);
/**
 * @route   GET /api/device-tokens
 * @desc    Get user's registered devices
 * @access  Private
 */ router.get('/', _devicetokencontroller.default.getUserTokens);
/**
 * @route   DELETE /api/device-tokens/all
 * @desc    Remove all device tokens for user (logout from all devices)
 * @access  Private
 */ router.delete('/all', _devicetokencontroller.default.removeAllTokens);
const _default = router;

//# sourceMappingURL=device-token.routes.js.map